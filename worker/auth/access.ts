import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { UserRole } from '../../shared/domain/types.ts';
import { fail, newId } from '../lib/http.ts';
import type { AppEnv, AuthUser } from '../types.ts';

// Cloudflare Access setter Cf-Access-Jwt-Assertion på alle forespørsler som slipper gjennom.
// Vi verifiserer signatur, utsteder og audience selv, slik at Workeren ikke kan nås forbi Access.

const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

async function identify(env: Env, token: string | undefined, devUser: string | undefined): Promise<string> {
  if (!env.ACCESS_AUD) {
    // Lokal utvikling: ingen Access foran. Krever DEV_USER_EMAIL i .dev.vars.
    // X-Dev-User lar deg bytte bruker lokalt (og i testene); virker aldri når Access er satt opp.
    if (env.DEV_USER_EMAIL) return (devUser || env.DEV_USER_EMAIL).toLowerCase();
    throw fail(500, 'Cloudflare Access er ikke konfigurert (ACCESS_AUD mangler).');
  }
  if (!env.ACCESS_TEAM_DOMAIN) throw fail(500, 'Cloudflare Access er ikke konfigurert (ACCESS_TEAM_DOMAIN mangler).');
  if (!token) throw fail(401, 'Ikke innlogget.');

  const issuer = `https://${env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  let jwks = jwksByTeam.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksByTeam.set(issuer, jwks);
  }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: env.ACCESS_AUD });
    if (typeof payload.email !== 'string' || !payload.email) throw new Error('mangler e-post');
    return payload.email.toLowerCase();
  } catch {
    throw fail(401, 'Ugyldig eller utløpt innlogging.');
  }
}

type UserRow = { id: string; email: string; name: string; short_name: string; initials: string; active: number; roles: string | null };

async function loadUser(db: D1Database, email: string) {
  return db
    .prepare(`SELECT u.id, u.email, u.name, u.short_name, u.initials, u.active,
                (SELECT group_concat(role) FROM user_roles r WHERE r.user_id = u.id) AS roles
              FROM users u WHERE u.email = ?`)
    .bind(email)
    .first<UserRow>();
}

/** Første innlogging for en e-post i ADMIN_EMAILS oppretter brukeren som admin. */
async function provisionAdmin(db: D1Database, email: string) {
  const local = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
  const name = local.replace(/\b\p{L}/gu, ch => ch.toUpperCase()) || email;
  const parts = name.split(' ');
  const short = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
  const initials = parts.map(p => p[0]).join('').slice(0, 2).toUpperCase();
  const id = newId('u');
  await db.batch([
    db.prepare('INSERT INTO users (id, email, name, short_name, initials) VALUES (?, ?, ?, ?, ?)').bind(id, email, name, short, initials),
    db.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, 'admin')").bind(id),
  ]);
}

export async function authenticate(env: Env, request: { header: (n: string) => string | undefined; cookie: () => string | undefined }): Promise<AuthUser> {
  const email = await identify(env, request.header('Cf-Access-Jwt-Assertion') ?? request.cookie(), request.header('X-Dev-User'));
  let row = await loadUser(env.DB, email);
  if (!row) {
    const admins = (env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!admins.includes(email)) throw fail(403, `${email} har ikke tilgang til Flow. Be en administrator legge deg til.`);
    await provisionAdmin(env.DB, email);
    row = await loadUser(env.DB, email);
    if (!row) throw fail(500, 'Kunne ikke opprette bruker.');
  }
  if (!row.active) throw fail(403, 'Brukeren er deaktivert.');
  return {
    id: row.id, email: row.email, name: row.name, short_name: row.short_name, initials: row.initials,
    roles: (row.roles ? row.roles.split(',') : []) as UserRole[],
  };
}

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  c.set('user', await authenticate(c.env, { header: n => c.req.header(n), cookie: () => getCookie(c, 'CF_Authorization') }));
  await next();
});

export const hasRole = (user: AuthUser, ...roles: UserRole[]) => user.roles.includes('admin') || roles.some(r => user.roles.includes(r));

/** Slipper gjennom admin og brukere med minst én av rollene. */
export const requireRole = (...roles: UserRole[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!hasRole(c.get('user'), ...roles)) throw fail(403, 'Du har ikke tilgang til dette.');
    await next();
  });

// Hvem kan gjøre hva.
export const CAN = {
  plan: ['salg', 'produksjon'] as UserRole[],        // opprette/endre/avlyse anløp
  crew: ['produksjon'] as UserRole[],                 // sette navn og ansvarlig, vakter
  quayLog: ['kaiarbeider', 'produksjon'] as UserRole[], // levere kaibok
  boats: ['salg', 'produksjon'] as UserRole[],        // redigere båter og agenter
  flag: ['produksjon'] as UserRole[],                 // overstyre flagg
  admin: [] as UserRole[],                            // bare admin
};
