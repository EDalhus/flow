import { useId } from 'react';
import type { Lang } from '../../../shared/api.ts';

// Små flagg ved språkene i innstillingene. Tegnet som SVG, så de ser like ut på alle maskiner
// (flagg-emoji vises som bokstaver på Windows).

const W = 22, H = 16;

function Cross({ bg, outer, inner, x }: { bg: string; outer: string; inner?: string; x: number }) {
  return (
    <>
      <rect width={W} height={H} fill={bg} />
      <rect x={x} width={4} height={H} fill={outer} /><rect y={6} width={W} height={4} fill={outer} />
      {inner && <><rect x={x + 1} width={2} height={H} fill={inner} /><rect y={7} width={W} height={2} fill={inner} /></>}
    </>
  );
}

function UnionJack() {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 60 30" width={W} height={H} preserveAspectRatio="xMidYMid slice">
      <clipPath id={`t${id}`}><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" /></clipPath>
      <rect width="60" height="30" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
      <path d="M0,0 L60,30 M60,0 L0,30" clipPath={`url(#t${id})`} stroke="#C8102E" strokeWidth="4" />
      <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
      <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
    </svg>
  );
}

export function LangFlag({ lang }: { lang: Lang }) {
  const frame = { borderRadius: 3, flex: 'none', boxShadow: '0 0 0 1px rgba(0,0,0,.18)', display: 'block' } as const;
  if (lang === 'en') return <span aria-hidden="true" style={{ ...frame, overflow: 'hidden', width: W, height: H }}><UnionJack /></span>;
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={frame}>
      {lang === 'nb' && <Cross bg="#BA0C2F" outer="#FFFFFF" inner="#00205B" x={6} />}
      {lang === 'is' && <Cross bg="#02529C" outer="#FFFFFF" inner="#DC1E35" x={6} />}
      {lang === 'da' && <><rect width={W} height={H} fill="#C8102E" /><rect x={7} width={2.4} height={H} fill="#fff" /><rect y={6.8} width={W} height={2.4} fill="#fff" /></>}
      {lang === 'sv' && <><rect width={W} height={H} fill="#006AA7" /><rect x={6.5} width={3} height={H} fill="#FECC02" /><rect y={6.5} width={W} height={3} fill="#FECC02" /></>}
      {lang === 'lt' && <><rect width={W} height={H / 3} fill="#FDB913" /><rect y={H / 3} width={W} height={H / 3} fill="#006A44" /><rect y={(2 * H) / 3} width={W} height={H / 3} fill="#C1272D" /></>}
    </svg>
  );
}
