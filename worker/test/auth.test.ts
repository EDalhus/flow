import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { OPEN_EMAIL, authenticate } from '../auth/access.ts';

// Åpen modus: uten Cloudflare Access og uten DEV_USER_EMAIL (slik produksjon kjører uten Access).
const openEnv = { ...env, DEV_USER_EMAIL: undefined, ACCESS_AUD: '' } as Env;
const req = (chosen?: string, token?: string) => ({ header: (n: string) => (n === 'Cf-Access-Jwt-Assertion' ? token : undefined), cookie: () => undefined, chosen });

describe('innlogging', () => {
  it('slipper inn uten Access som den innebygde admin-brukeren «Flow»', async () => {
    const u = await authenticate(openEnv, req());
    expect(u).toMatchObject({ email: OPEN_EMAIL, name: 'Flow', short_name: 'Flow', initials: 'FL', roles: ['admin'], open: true });
    // Andre gang gjenbrukes samme bruker.
    expect((await authenticate(openEnv, req())).id).toBe(u.id);
  });

  it('lar brukeren velge hvem hen er, og faller tilbake ved ukjent valg', async () => {
    expect(await authenticate(openEnv, req('Ola@flow.example'))).toMatchObject({ id: 'u_ola', open: true });
    expect(await authenticate(openEnv, req('finnes.ikke@example.com'))).toMatchObject({ email: OPEN_EMAIL });
  });

  it('krever gyldig Access-token når Access er konfigurert', async () => {
    const accessEnv = { ...openEnv, ACCESS_AUD: 'aud-tag', ACCESS_TEAM_DOMAIN: 'firma.cloudflareaccess.com' } as Env;
    await expect(authenticate(accessEnv, req('ola@flow.example'))).rejects.toMatchObject({ status: 401 });
    await expect(authenticate({ ...accessEnv, ACCESS_TEAM_DOMAIN: '' } as Env, req())).rejects.toMatchObject({ status: 500 });
  });
});
