// Legger inn eksempeldata i D1 i Cloudflare – bare når SEED_DEMO=1 er satt OG databasen er tom.
// Kjøres av deploy-kommandoen i Workers Builds. Overskriver aldri eksisterende data.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.env.SEED_DEMO !== '1') {
  console.log('Eksempeldata: hopper over (SEED_DEMO er ikke satt til 1).');
  process.exit(0);
}

const wrangler = (...args) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--remote', '--config', 'wrangler.jsonc', ...args], { encoding: 'utf8' });

const out = wrangler('--command', 'SELECT count(*) AS n FROM users', '--json');
const n = JSON.parse(out)[0]?.results?.[0]?.n;
if (n === undefined) {
  console.warn('Eksempeldata: fikk ikke lest databasen – hopper over.', out);
  process.exit(0);
}
if (n !== 0) {
  console.log(`Eksempeldata: databasen har allerede ${n} brukere – legger ikke inn noe.`);
  process.exit(0);
}

// Datoene i eksempeldataene regnes fra i dag.
const sql = execFileSync('node', ['seed/generate.ts'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const file = join(mkdtempSync(join(tmpdir(), 'flow-seed-')), 'seed.sql');
writeFileSync(file, sql);
wrangler('--file', file, '--yes');
console.log('Eksempeldata lagt inn. Fjern SEED_DEMO fra byggvariablene når du ikke trenger det lenger.');
