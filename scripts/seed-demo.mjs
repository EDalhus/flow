// Legger inn eksempeldata i D1 i Cloudflare under Workers Builds.
//   SEED_DEMO=1     – bare hvis databasen er tom (ingen brukere)
//   SEED_DEMO=force – tømmer alle tabeller og legger inn på nytt (sletter eksisterende data)
// Må settes som Build variable (Settings → Build), ikke som Worker-variabel.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mode = process.env.SEED_DEMO;
if (mode !== '1' && mode !== 'force') {
  console.log('Eksempeldata: hopper over (sett Build-variabelen SEED_DEMO til 1 eller force).');
  process.exit(0);
}

const wrangler = (...args) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--remote', '--config', 'wrangler.jsonc', ...args], { encoding: 'utf8' });

if (mode === '1') {
  const out = wrangler('--command', 'SELECT count(*) AS n FROM users', '--json');
  const n = JSON.parse(out)[0]?.results?.[0]?.n;
  if (n === undefined) {
    console.warn('Eksempeldata: fikk ikke lest databasen – hopper over.', out);
    process.exit(0);
  }
  if (n !== 0) {
    console.log(`Eksempeldata: databasen har allerede ${n} brukere – legger ikke inn noe. Sett SEED_DEMO=force for å tømme og legge inn på nytt.`);
    process.exit(0);
  }
} else {
  console.log('Eksempeldata: SEED_DEMO=force – tømmer databasen og legger inn eksempeldata.');
}

// Datoene i eksempeldataene regnes fra i dag. SQL-en starter med DELETE FROM alle tabeller.
const sql = execFileSync('node', ['seed/generate.ts'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const file = join(mkdtempSync(join(tmpdir(), 'flow-seed-')), 'seed.sql');
writeFileSync(file, sql);
wrangler('--file', file, '--yes');
console.log('Eksempeldata lagt inn. Fjern SEED_DEMO fra Build-variablene når du ikke trenger det lenger.');
