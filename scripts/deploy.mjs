// Deploy-kommando for Workers Builds: `npm run deploy:cf`.
//
// 0. Bygger appen. Alltid, så en gjenopprettet byggcache aldri deployes, og så skriptet virker
//    enten det står som Build command eller Deploy command i Workers Builds.
// 1. Migrasjoner før deploy, så ny kode møter nytt skjema. Første gang finnes ikke databasen ennå;
//    da hoppes dette over, og wrangler deploy oppretter den.
// 2. wrangler deploy (oppretter D1 og R2 automatisk første gang).
// 3. Migrasjoner igjen – gjør ingenting hvis alt alt er kjørt, men lager tabellene ved første deploy.
// 4. Eksempeldata hvis SEED_DEMO=1 og databasen er tom.
import { execFileSync } from 'node:child_process';

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });
run('npm', ['run', 'build']);

const migrate = () => run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--remote', '--config', 'wrangler.jsonc']);

try {
  migrate();
} catch {
  console.log('Migrasjoner før deploy hoppet over (databasen finnes trolig ikke ennå). Prøver igjen etter deploy.');
}
run('npx', ['wrangler', 'deploy']);
migrate();
run('node', ['scripts/seed-demo.mjs']);
