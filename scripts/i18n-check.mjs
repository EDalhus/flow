// Sjekker oversettelsene: alle tekster som sendes gjennom tr() i web/src, og tekstene fra serveren
// i web/src/i18n/server.ts, skal finnes i hver ordbok. Viser også nøkler som ikke brukes lenger.
// Bruk: node scripts/i18n-check.mjs [--keys]   (--keys skriver alle nøklene som JSON)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const files = [];
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (!p.endsWith('i18n')) walk(p); } else if (/\.tsx?$/.test(f)) files.push(p); } };
walk(join(root, 'web/src'));

const unescape = s => s.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');
const keys = new Set();
const lit = /(['"])((?:\\.|(?!\1)[^\\])*)\1/;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\btr\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g)) keys.add(unescape(m[2]));
  if (/\btr\(\s*`/.test(src)) console.error(`${f}: tr() med mal-streng (\`…\`) – bruk vanlige anførselstegn og {navn}.`);
}
const server = readFileSync(join(root, 'web/src/i18n/server.ts'), 'utf8');
for (const m of server.matchAll(new RegExp(lit.source, 'g'))) if (!m[2].startsWith('../')) keys.add(unescape(m[2]));

if (process.argv.includes('--keys')) { console.log(JSON.stringify([...keys].sort(), null, 1)); process.exit(0); }

let bad = 0;
for (const l of ['en', 'lt', 'da', 'sv', 'is']) {
  const src = readFileSync(join(root, `web/src/i18n/${l}.ts`), 'utf8');
  const have = new Set([...src.matchAll(/^\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*:/gm)].map(m => unescape(m[2])));
  const missing = [...keys].filter(k => !have.has(k));
  const unused = [...have].filter(k => !keys.has(k));
  if (missing.length) { bad++; console.log(`${l}: mangler ${missing.length}`); for (const k of missing.slice(0, 400)) console.log(`  ${JSON.stringify(k)}`); }
  if (unused.length) console.log(`${l}: ${unused.length} ubrukte`, unused.slice(0, 20));
}
console.log(`${keys.size} tekster i alt.`);
process.exit(bad ? 1 : 0);
