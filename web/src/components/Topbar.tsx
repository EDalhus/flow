import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { chooseUser } from '../lib/api.ts';
import { useMe, useUsers } from '../lib/queries.ts';
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

/**
 * Avatar som også er brukervelger når appen kjører uten Cloudflare Access.
 * Med Access er det bare et merke med initialene.
 */
export function UserBadge({ size = 46, align = 'right' }: { size?: number; align?: 'left' | 'right' }) {
  const me = useMe();
  const users = useUsers();
  const [open, setOpen] = useState(false);
  if (!me.data?.open) return <Avatar initials={me.data?.initials} size={size} />;
  const pick = (email: string | null) => { chooseUser(email); window.location.reload(); };
  return (
    <span style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Du er ${me.data.name}. Bytt bruker`}
        style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', borderRadius: '50%' }}>
        <Avatar initials={me.data.initials} size={size} />
      </button>
      {open && (
        <div className="glass scroll" role="dialog" aria-label="Velg bruker"
          style={{ position: 'absolute', top: size + 10, [align]: 0, width: 280, maxHeight: 420, padding: 10, zIndex: 40, background: 'rgba(17,21,25,.92)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ padding: '4px 8px 6px', fontSize: 13, color: 'var(--fg-62)' }}>Hvem er du? Flow kjører uten innlogging.</span>
          {(users.data ?? []).map(u => (
            <button key={u.id} type="button" className="tab" aria-pressed={u.id === me.data!.id} onClick={() => pick(u.email)}
              style={{ justifyContent: 'flex-start', textAlign: 'left', display: 'flex', gap: 10, alignItems: 'center', minHeight: 44 }}>
              <span style={{ width: 28, height: 28, flex: 'none', borderRadius: '50%', background: 'rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>{u.initials}</span>
              <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                <span>{u.name}</span>
                <span style={{ fontSize: 12, color: 'var(--fg-55)' }}>{u.title ?? u.roles.join(', ')}</span>
              </span>
            </button>
          ))}
        </div>
      )}
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
        <UserBadge />
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
