import type { CSSProperties, ReactNode } from 'react';
import type { BoatSummary, PortCallView, QuayRef } from '../../../shared/api.ts';
import type { CallStatus, Flag } from '../../../shared/domain/types.ts';
import { FLAG_STYLE, STATUS_STYLE, fr, isOwnQuay, quayTitle, ratingColor } from '../lib/format.ts';
import { Flag as FlagIcon, Search, Star } from './Icons.tsx';

export function StatusBadge({ status, basis, size = 'sm' }: { status: CallStatus; basis?: PortCallView['status_basis']; size?: 'sm' | 'lg' }) {
  const s = STATUS_STYLE[status];
  const estimated = basis === 'tid' && status === 'ved_kai';
  const lg = size === 'lg';
  return (
    <span className="badge" title={estimated ? 'Anslått ut fra ETA/ETD – ingen AIS-posisjon ennå' : undefined}
      style={lg
        ? { background: s.solid, color: s.solidFg, padding: '6px 12px', fontSize: 14, fontWeight: 500, gap: 7 }
        : ({ background: s.bg, '--badge-c': s.c, color: 'var(--badge-c)' } as CSSProperties)}>
      <span className="dot" style={{ background: lg ? s.solidFg === '#1A231E' ? '#1A231E' : s.c : s.c, width: lg ? 8 : 6, height: lg ? 8 : 6, opacity: lg && s.solidFg === '#1A231E' ? .7 : 1 }} />
      {s.label}
    </span>
  );
}

export function FlagBadge({ flag, icon = true, style }: { flag: Flag; icon?: boolean; style?: CSSProperties }) {
  const f = FLAG_STYLE[flag];
  return (
    <span className="badge" style={{ background: f.bg, '--badge-c': f.c, color: 'var(--badge-c)', gap: 5, padding: '3px 9px', ...style } as CSSProperties}>
      {icon && <FlagIcon size={11} />}
      {f.label}
    </span>
  );
}

/** Tydelig merke: «Vår» vs «Nabo», med kallenavn som hovedtekst. */
export function QuayMark({ quay, compact }: { quay: Pick<QuayRef, 'name' | 'nickname' | 'company'>; compact?: boolean }) {
  const own = isOwnQuay(quay);
  const title = quayTitle(quay);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: compact ? 5 : 7, minWidth: 0, maxWidth: '100%' }}>
      {/* Egne kaier er standard og trenger ikke merke; bare naboens kaier merkes. */}
      {!own && (
        <span className="badge" style={{ flex: 'none', fontSize: compact ? 10 : 11, padding: compact ? '2px 6px' : '3px 8px', fontWeight: 500, background: 'rgba(232,176,110,.18)', color: '#C98A3E' }}>
          Nabo
        </span>
      )}
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, minWidth: 0 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        {!own && quay.company && (
          <span style={{ fontSize: compact ? 11 : 12, color: 'var(--fg-55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{quay.company}</span>
        )}
      </span>
    </span>
  );
}

export function Rating({ value, suffix }: { value: number | null; suffix?: ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--fg-85)' }}>
      <Star size={12} />
      <span className="n">{fr(value)}</span>
      {suffix}
    </span>
  );
}

/** Flaggprikk + "Grønt · 4,6" (Anløp-tabellen). */
export function BoatFlagLine({ boat }: { boat: BoatSummary }) {
  const f = FLAG_STYLE[boat.flag];
  return (
    <span style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
      <span className="dot" style={{ width: 7, height: 7, background: f.dot }} />
      <span className="muted">{f.label} · {boat.rating_count ? fr(boat.avg_total) : '–'}</span>
    </span>
  );
}

export function Stars({ value, size = 16, label }: { value: number; size?: number; label?: string }) {
  return (
    <span className="stars" role="img" aria-label={label ?? `${value} av 5`}>
      {[1, 2, 3, 4, 5].map(n => <Star key={n} size={size} fill={n <= value ? '#F7B955' : 'rgba(var(--tint), .14)'} />)}
    </span>
  );
}

/** Pille-segmenter (filtre, faner). */
export function Segmented<T extends string>({ value, options, onChange, label, stretch, style }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string; stretch?: boolean; style?: CSSProperties;
}) {
  return (
    <div role="group" aria-label={label} className="pill seg" style={style}>
      {options.map(o => (
        <button key={o.value} type="button" className="tab" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
          style={stretch ? { flex: 1, padding: '0 6px' } : undefined}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder, label, width = 220 }: {
  value: string; onChange: (v: string) => void; placeholder: string; label: string; width?: number | string;
}) {
  return (
    <label className="pill search" style={{ width }}>
      <span className="sr">{label}</span>
      <Search size={16} />
      <input type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

/** Tre vurderingsstolper (punktlighet, samarbeid, utstyr). */
export function RatingBars({ values, variant = 'long' }: {
  values: { p: number | null; s: number | null; u: number | null }; variant?: 'long' | 'card';
}) {
  const rows: [string, string, number | null][] = [
    ['Punktlighet', 'Punktlighet', values.p],
    ['Samarbeid', 'Samarbeidsvilje (mannskap)', values.s],
    ['Utstyr', 'Utstyr / kran', values.u],
  ];
  if (variant === 'card') {
    return (
      <span style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
        {rows.map(([short, , v]) => (
          <span key={short} style={{ display: 'grid', gridTemplateColumns: '72px 1fr 26px', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(var(--tint), .65)' }}>
            <span>{short}</span>
            <span style={{ height: 4, borderRadius: 2, background: 'rgba(var(--tint), .08)', overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', borderRadius: 2, width: v == null ? 0 : `${(v / 5) * 100}%`, background: v == null ? 'transparent' : ratingColor(v) }} />
            </span>
            <span className="n" style={{ textAlign: 'right' }}>{fr(v)}</span>
          </span>
        ))}
      </span>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map(([, long, v]) => (
        <div key={long} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span>{long}</span><span className="n" style={{ color: 'var(--fg-75)' }}>{fr(v)}</span>
          </div>
          <div style={{ height: 4, background: 'rgba(var(--tint), .08)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 2, width: v == null ? 0 : `${(v / 5) * 100}%`, background: v == null ? 'transparent' : ratingColor(v) }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Stort tall med dempet desimal: "4" + ",6". */
export function BigNumber({ value, size = 42, digits = 1 }: { value: number | null; size?: number; digits?: number }) {
  const t = value == null ? '–' : fr(value, digits);
  const i = t.indexOf(',');
  return (
    <span className="n" style={{ fontSize: size, fontWeight: 200, lineHeight: 1, letterSpacing: '-0.02em' }}>
      {i < 0 ? t : t.slice(0, i)}
      {i >= 0 && <span style={{ color: 'var(--fg-45)' }}>{t.slice(i)}</span>}
    </span>
  );
}

export function Loading({ text = 'Laster …' }: { text?: string }) {
  return <p className="empty loading" role="status">{text}</p>;
}

/**
 * Det som krever oppmerksomhet på et anløp, som små merker: kollisjon, mannskap som mangler
 * og gult/rødt flagg. Ingenting vises når alt er i orden, så listene holder seg rolige.
 */
export function CallIssues({ call, showFlag = true }: { call: PortCallView; showFlag?: boolean }) {
  const done = call.status === 'ferdig' || call.status === 'avlyst';
  const open = call.crew.filter(s => !s.user).length;
  const chips: { key: string; text: string; title?: string; tone: 'bad' | 'warn' }[] = [];
  if (call.collisions.length && !done) {
    const boats = [...new Set(call.collisions.flatMap(x => x.with.map(w => w.boat_name)))];
    chips.push({ key: 'c', tone: 'bad', text: boats.length ? `Kolliderer med ${boats.join(', ')}` : 'Kollisjon', title: call.collisions.map(x => x.text).join(' · ') });
  }
  if (!done && call.crew.length && !call.responsible) chips.push({ key: 'a', tone: 'warn', text: 'Ansvarlig mangler' });
  else if (!done && open) chips.push({ key: 'o', tone: 'warn', text: `${open} ${open === 1 ? 'rolle' : 'roller'} uten navn` });
  if (showFlag && (call.boat.flag === 'red' || call.boat.flag === 'yellow')) {
    chips.push({ key: 'f', tone: call.boat.flag === 'red' ? 'bad' : 'warn', text: FLAG_STYLE[call.boat.flag].label, title: call.boat.flag_reason ?? undefined });
  }
  if (!chips.length) return null;
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {chips.map(ch => (
        <span key={ch.key} className="badge" title={ch.title}
          style={{ fontSize: 12, padding: '3px 9px', '--badge-c': ch.tone === 'bad' ? '#FF6B5E' : '#F7B955', color: ch.tone === 'bad' ? 'var(--bad-fg)' : 'var(--warn-fg)', background: ch.tone === 'bad' ? 'rgba(229,72,77,.14)' : 'rgba(247,185,85,.16)' } as CSSProperties}>
          <span className="dot" style={{ background: 'currentColor' }} />{ch.text}
        </span>
      ))}
    </span>
  );
}

/** Nøkkeltall på én rolig rad uten bokser, skilt med tynne linjer (som «Main Statistics»). */
export function StatStrip({ items }: { items: { label: string; value: ReactNode; unit?: string; note?: ReactNode }[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px 0' }}>
      {items.map((it, i) => (
        <div key={it.label} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: i ? '0 32px' : '0 32px 0 0', borderLeft: i ? '1px solid var(--line)' : undefined, minWidth: 150 }}>
          <span style={{ fontSize: 13, color: 'var(--sage)' }}>{it.label}</span>
          <span className="n" style={{ fontSize: 38, fontWeight: 200, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
            {it.value}{it.unit && <span style={{ fontSize: 18, color: 'var(--fg-45)' }}>{it.unit}</span>}
          </span>
          {it.note && <span className="n" style={{ fontSize: 13, color: 'var(--fg-62)' }}>{it.note}</span>}
        </div>
      ))}
    </div>
  );
}
