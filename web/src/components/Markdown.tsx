import type { ReactNode } from 'react';
import { isInternalHref, parseMarkdown, type Inline } from '../../../shared/markdown.ts';

// Svarene fra «Spør Flow»: første avsnitt er konklusjonen (litt større), lister og lenker inn i Flow som små brikker.

function inline(list: Inline[], go: (to: string) => void, k = ''): ReactNode[] {
  return list.map((x, i) => {
    const key = `${k}${i}`;
    switch (x.t) {
      case 'text': return x.v;
      case 'bold': return <strong key={key} style={{ fontWeight: 600, color: 'var(--fg)' }}>{inline(x.c, go, `${key}-`)}</strong>;
      case 'em': return <em key={key}>{inline(x.c, go, `${key}-`)}</em>;
      case 'code': return <code key={key} className="n" style={{ fontSize: '.92em', padding: '1px 5px', borderRadius: 6, background: 'rgba(var(--tint), .08)' }}>{x.v}</code>;
      case 'link': return isInternalHref(x.href)
        ? <a key={key} href={x.href} className="md-link" onClick={e => { e.preventDefault(); go(x.href); }}>{inline(x.c, go, `${key}-`)}</a>
        : <span key={key}>{inline(x.c, go, `${key}-`)}</span>;
    }
  });
}

export function Markdown({ text, go, size = 14 }: { text: string; go: (to: string) => void; size?: number }) {
  const blocks = parseMarkdown(text);
  const firstP = blocks.findIndex(b => b.t === 'p');
  return (
    <div className="md" style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: size, lineHeight: 1.55, color: 'var(--fg-75)' }}>
      {blocks.map((b, i) => {
        if (b.t === 'h') return <h3 key={i} className="eyebrow" style={{ margin: '4px 0 -4px', fontSize: 11, fontWeight: 500 }}>{inline(b.c, go)}</h3>;
        if (b.t === 'p') {
          return (
            <p key={i} style={{ margin: 0, ...(i === firstP ? { fontSize: size + 1.5, color: 'var(--fg)' } : {}) }}>
              {b.lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l, go, `${i}-${j}-`)}</span>)}
            </p>
          );
        }
        const Tag = b.t;
        return (
          <Tag key={i} className={`md-list md-${b.t}`}>
            {b.items.map((it, j) => <li key={j}>{inline(it, go, `${i}-${j}-`)}</li>)}
          </Tag>
        );
      })}
    </div>
  );
}
