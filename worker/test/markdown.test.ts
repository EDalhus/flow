import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from '../../shared/markdown.ts';

// Svarene fra «Spør Flow» vises med en liten markdown-tolker.

describe('markdown i svarene', () => {
  it('tolker lenker inne i fet tekst og id-er med understrek', () => {
    expect(parseInline('**[Polarstrand](/baater?id=b_polarstrand)** har flest')).toEqual([
      { t: 'bold', c: [{ t: 'link', href: '/baater?id=b_polarstrand', c: [{ t: 'text', v: 'Polarstrand' }] }] },
      { t: 'text', v: ' har flest' },
    ]);
    expect(parseInline('snake_case_navn og *kursiv*')).toEqual([{ t: 'text', v: 'snake_case_navn og ' }, { t: 'em', c: [{ t: 'text', v: 'kursiv' }] }]);
  });

  it('lager liste rett etter en tekstlinje, og skiller avsnitt og overskrifter', () => {
    const b = parseMarkdown('### Topp\nNeste på listen:\n- [MS Nordkyn](/baater?id=b_n) har 2 avvik\n- Brattholm\n\n1. en\n2. to\nSlutt');
    expect(b.map(x => x.t)).toEqual(['h', 'p', 'ul', 'ol', 'p']);
    expect(b[2]).toMatchObject({ t: 'ul', items: [[{ t: 'link' }, { t: 'text', v: ' har 2 avvik' }], [{ t: 'text', v: 'Brattholm' }]] });
  });
});
