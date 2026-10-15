import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

// Testene kjører migrasjonene på en tom database, så de fanger ikke feil som bare
// oppstår med data. D1 håndhever fremmednøkler: DROP TABLE på en tabell andre peker på
// (f.eks. quays ← port_calls) feiler i produksjon uten PRAGMA defer_foreign_keys = on.
describe('migrasjoner', () => {
  it('slår på defer_foreign_keys når en tabell bygges på nytt', () => {
    for (const m of env.TEST_MIGRATIONS) {
      const sql = m.queries.join('\n');
      if (/\bDROP\s+TABLE\b/i.test(sql)) {
        expect(sql, `${m.name} sletter en tabell uten PRAGMA defer_foreign_keys = on`).toMatch(/PRAGMA\s+defer_foreign_keys\s*=\s*on/i);
      }
    }
  });
});
