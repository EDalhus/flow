import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { loadFixtures } from './fixtures.ts';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
await loadFixtures(env.DB);
