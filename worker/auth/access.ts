import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { UserRole } from '../../shared/domain/types.ts';
import { fail, newId } from '../lib/http.ts';
import type { AppEnv, AuthUser } from '../types.ts';

// Innlogging er valgfri.
//  - Med Cloudflare Access (ACCESS_AUD + ACCESS_TEAM_DOMAIN satt): Access setter Cf-Access-Jwt-Assertion,
//    og vi verifiserer signatur, utsteder og audience selv.
//  - Uten Access («åpen modus»): ingen innlogging. Brukeren velger hvem hen er i appen (X-Flow-As),
//    ellers brukes den innebygde brukeren «Flow». Alle med adressen kan da se og endre alt.

/** Innebygd bruker i åpen modus. Opprettes automatisk som admin. */
export const OPEN_EMAIL = 'flow@flow.local';

const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

type Who = { email: string; open: boolean };

async function identify(env: Env, token: string | undefined, devUser: string | undefined, chosen: string | undefined): Promise<Who> {
  if (!env.ACCESS_AUD) {
    // Lokal utvikling og tester: DEV_USER_EMAIL, byttes med X-Dev-User.
    if (env.DEV_USER_EMAIL) return { email: (devUser || env.DEV_USER_EMAIL).toLowerCase(), open: true };
    return { email: (chosen || OPEN_EMAIL).toLowerCase(), open: true };
  }
  if (!env.ACCESS_TEAM_DOMAIN) throw fail(500, 'Cloudflare Access er delvis konfigurert: ACCESS_TEAM_DOMAIN mangler.');
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
    return { email: payload.email.toLowerCase(), open: false };
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

/** Oppretter en admin: ved første innlogging for ADMIN_EMAILS, eller den innebygde «Flow»-brukeren. */
async function provisionAdmin(db: D1Database, email: string) {
  const local = email === OPEN_EMAIL ? 'flow' : email.split('@')[0].replace(/[._-]+/g, ' ').trim();
  const name = local.replace(/\b\p{L}/gu, ch => ch.toUpperCase()) || email;
  const parts = name.split(' ');
  const short = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
  const initials = (parts.length > 1 ? parts.map(p => p[0]).join('') : name.slice(0, 2)).slice(0, 2).toUpperCase();
  const id = newId('u');
  await db.batch([
    db.prepare('INSERT INTO users (id, email, name, short_name, initials) VALUES (?, ?, ?, ?, ?)').bind(id, email, name, short, initials),
    db.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, 'admin')").bind(id),
  ]);
}

export async function authenticate(env: Env, request: {
  header: (n: string) => string | undefined; cookie: () => string | undefined; chosen?: string;
}): Promise<AuthUser> {
  const who = await identify(env, request.header('Cf-Access-Jwt-Assertion') ?? request.cookie(), request.header('X-Dev-User'), request.chosen);
  let email = who.email;
  let row = await loadUser(env.DB, email);
  // Åpen modus: ukjent eller deaktivert valgt bruker → den innebygde brukeren.
  if (who.open && !env.DEV_USER_EMAIL && email !== OPEN_EMAIL && (!row || !row.active)) {
    email = OPEN_EMAIL;
    row = await loadUser(env.DB, email);
  }
  if (!row && who.open && email === OPEN_EMAIL) {
    await provisionAdmin(env.DB, email);
    row = await loadUser(env.DB, email);
  }
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
    open: who.open,
  };
}

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  c.set('user', await authenticate(c.env, {
    header: n => c.req.header(n),
    cookie: () => getCookie(c, 'CF_Authorization'),
    // Brukervalg i åpen modus; WebSocket kan ikke sette headere, så den bruker ?as=.
    chosen: c.req.header('X-Flow-As') ?? c.req.query('as'),
  }));
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
