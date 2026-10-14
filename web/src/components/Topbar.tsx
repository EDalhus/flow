import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { useMe } from '../lib/queries.ts';
import { AlertsPanel, useAlerts } from './Alerts.tsx';
import { Bell, Logo } from './Icons.tsx';

const LINKS = [
  ['/', 'Kart'],
  ['/anlop', 'Anløp'],
  ['/baater', 'Båter'],
  ['/kaibok', 'Kaibok'],
  ['/rapporter', 'Rapporter'],
] as const;

export function Avatar({ initials, size = 46 }: { initials?: string; size?: number }) {
  return (
    <span aria-label="Innlogget bruker" role="img"
      style={{ width: size, height: size, borderRadius: '50%', background: 'linear-gradient(140deg, #3A4A5A, #1B232B)', border: '1px solid rgba(255,255,255,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 500, flex: 'none' }}>
      {initials ?? ''}
    </span>
  );
}

export function BellButton({ open, onToggle, glass }: { open: boolean; onToggle: () => void; glass?: boolean }) {
  const { count } = useAlerts();
  return (
    <button type="button" className="icon-btn pill" onClick={onToggle} aria-expanded={open}
      aria-label={count ? `${count} varsler` : 'Varsler'} style={{ position: 'relative', backdropFilter: glass ? 'blur(16px)' : undefined }}>
      <Bell size={19} />
      {count > 0 && (
        <span className="n" style={{ position: 'absolute', top: -2, right: -2, minWidth: 20, height: 20, borderRadius: 10, background: '#E5484D', color: '#fff', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>
          {count}
        </span>
      )}
    </button>
  );
}

/** Logo, faner, søk (valgfritt), bjelle og avatar. */
export function Topbar({ search, style, glass, alertsOpen, onAlerts }: {
  search?: ReactNode; style?: CSSProperties; glass?: boolean;
  /** Styrt utenfra (kartet viser panelet selv); ellers egen tilstand og panel under bjella. */
  alertsOpen?: boolean; onAlerts?: (open: boolean) => void;
}) {
  const me = useMe();
  const [own, setOwn] = useState(false);
  const controlled = alertsOpen !== undefined;
  const alerts = controlled ? alertsOpen : own;
  const setAlerts = (v: boolean) => (controlled ? onAlerts?.(v) : setOwn(v));
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!alerts) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAlerts(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts]);

  return (
    <header ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', zIndex: 20, ...style }}>
      <div style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Logo /></div>
      <nav aria-label="Hovedmeny" style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        {[...LINKS, ...(me.data?.roles.includes('admin') ? [['/admin', 'Brukere'] as const] : [])].map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav${isActive ? ' active' : ''}`}>{label}</NavLink>
        ))}
      </nav>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        {search}
        <BellButton open={alerts} onToggle={() => setAlerts(!alerts)} glass={glass} />
        <Avatar initials={me.data?.initials} />
      </div>
      {alerts && !controlled && <AlertsPanel onClose={() => setAlerts(false)} style={{ position: 'absolute', top: 60, right: 0 }} />}
    </header>
  );
}

/** Ramme for sidene med kystbakgrunn. */
export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="page">
      <img className="page-bg" src="/kyst.jpg" alt="" />
      <div className="page-veil" aria-hidden="true" />
      <Topbar style={{ padding: '20px 24px 0' }} />
      <main className="page-main">{children}</main>
    </div>
  );
}
