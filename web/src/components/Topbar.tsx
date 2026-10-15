import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { chooseUser } from '../lib/api.ts';
import { useMe, useUsers } from '../lib/queries.ts';
import { AlertsPanel, useAlerts } from './Alerts.tsx';
import { Bell, Book, CalendarList, Chevron, Globe, Logo, PieChart, Ship, Users } from './Icons.tsx';

const LINKS = [
  { to: '/', label: 'Kart', icon: Globe },
  { to: '/anlop', label: 'Anløp', icon: CalendarList },
  { to: '/baater', label: 'Båter', icon: Ship },
  { to: '/kaibok', label: 'Kaibok', icon: Book },
  { to: '/rapporter', label: 'Rapporter', icon: PieChart },
] as const;

/** Smal ikonmeny til venstre (som i referansen). Tekst vises som hint ved hover/fokus. */
export function Sidebar() {
  const me = useMe();
  const links = [...LINKS, ...(me.data?.roles.includes('admin') ? [{ to: '/admin', label: 'Admin', icon: Users }] : [])];
  return (
    <nav className="sidebar" aria-label="Hovedmeny">
      <NavLink to="/" aria-label="Flow – til kartet" style={{ width: 52, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 'auto' }}>
        <Logo size={34} />
      </NavLink>
      {links.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} end={to === '/'} aria-label={label} className={({ isActive }) => `side-link${isActive ? ' active' : ''}`}>
          <Icon size={21} />
          <span className="side-tip" aria-hidden="true">{label}</span>
        </NavLink>
      ))}
      <span style={{ marginTop: 'auto' }} />
    </nav>
  );
}

export function Avatar({ initials, size = 46 }: { initials?: string; size?: number }) {
  return (
    <span aria-hidden="true"
      style={{ width: size, height: size, borderRadius: '50%', background: 'linear-gradient(140deg, #475A4E, #28332C)', border: '1px solid rgba(var(--tint), .16)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * .32), fontWeight: 500, flex: 'none', color: 'var(--fg)' }}>
      {initials ?? ''}
    </span>
  );
}

/** Liste for å velge bruker når appen kjører uten Cloudflare Access. */
function UserMenu({ top, align, onClose }: { top: number; align: 'left' | 'right'; onClose: () => void }) {
  const me = useMe();
  const users = useUsers();
  const pick = (email: string | null) => { chooseUser(email); window.location.reload(); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="glass scroll" role="dialog" aria-label="Velg bruker"
      style={{ position: 'absolute', top, [align]: 0, width: 280, maxHeight: 420, padding: 10, zIndex: 40, background: 'rgba(32,42,36,.95)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="eyebrow" style={{ padding: '4px 8px 6px' }}>Hvem er du?</span>
      {(users.data ?? []).map(u => (
        <button key={u.id} type="button" className="tab" aria-pressed={u.id === me.data?.id} onClick={() => pick(u.email)}
          style={{ justifyContent: 'flex-start', textAlign: 'left', display: 'flex', gap: 10, alignItems: 'center', minHeight: 46 }}>
          <span style={{ width: 28, height: 28, flex: 'none', borderRadius: '50%', background: 'rgba(var(--tint), .1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>{u.initials}</span>
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <span>{u.name}</span>
            <span style={{ fontSize: 12, opacity: .7 }}>{u.title ?? u.roles.join(', ')}</span>
          </span>
        </button>
      ))}
      <span style={{ padding: '6px 8px 2px', fontSize: 12, color: 'var(--fg-55)' }}>Flow kjører uten innlogging.</span>
    </div>
  );
}

/** Rund avatar (mobil). Brukervelger når appen kjører uten Access. */
export function UserBadge({ size = 46, align = 'right' }: { size?: number; align?: 'left' | 'right' }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  if (!me.data?.open) return <span role="img" aria-label={me.data?.name ?? 'Innlogget bruker'}><Avatar initials={me.data?.initials} size={size} /></span>;
  return (
    <span style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Du er ${me.data.name}. Bytt bruker`}
        style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', borderRadius: '50%' }}>
        <Avatar initials={me.data.initials} size={size} />
      </button>
      {open && <UserMenu top={size + 10} align={align} onClose={() => setOpen(false)} />}
    </span>
  );
}

/** Brukerpille med avatar og navn (desktop), som «Evan H. ⌄» i referansen. */
export function UserPill() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const canSwitch = !!me.data?.open;
  const body = (
    <>
      <Avatar initials={me.data?.initials} size={36} />
      <span style={{ fontSize: 14 }}>{me.data?.short_name}</span>
      {canSwitch && <Chevron size={16} style={{ transform: open ? 'rotate(180deg)' : undefined, opacity: .8 }} />}
    </>
  );
  const style: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '5px 14px 5px 5px', borderRadius: 999, background: 'rgba(var(--tint), .08)', border: '1px solid var(--line)', color: 'var(--fg)', backdropFilter: 'blur(16px)' };
  if (!canSwitch) return <span style={style} aria-label={`Innlogget som ${me.data?.name ?? ''}`}>{body}</span>;
  return (
    <span style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Du er ${me.data?.name}. Bytt bruker`} style={{ ...style, cursor: 'pointer' }}>
        {body}
      </button>
      {open && <UserMenu top={58} align="right" onClose={() => setOpen(false)} />}
    </span>
  );
}

/** Lys rund bjelle med aqua-markering (som i referansen). */
export function BellButton({ open, onToggle, glass }: { open: boolean; onToggle: () => void; glass?: boolean }) {
  const { count } = useAlerts();
  return (
    <button type="button" className="icon-btn" onClick={onToggle} aria-expanded={open}
      aria-label={count ? `${count} varsler` : 'Varsler'}
      style={{ position: 'relative', background: 'var(--fg)', color: 'var(--ink)', width: 48, height: 48, backdropFilter: glass ? 'blur(16px)' : undefined }}>
      <Bell size={19} />
      {count > 0 && (
        <span className="n" style={{ position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, borderRadius: 10, background: 'var(--aqua)', color: 'var(--ink)', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', border: '2px solid var(--bg)' }}>
          {count}
        </span>
      )}
    </button>
  );
}

/** Topplinje: valgfritt innhold til venstre/midten, bjelle og brukerpille til høyre. */
export function Topbar({ search, center, style, glass, alertsOpen, onAlerts }: {
  search?: ReactNode; center?: ReactNode; style?: CSSProperties; glass?: boolean;
  /** Styrt utenfra (kartet viser panelet selv); ellers egen tilstand og panel under bjella. */
  alertsOpen?: boolean; onAlerts?: (open: boolean) => void;
}) {
  const [own, setOwn] = useState(false);
  const controlled = alertsOpen !== undefined;
  const alerts = controlled ? alertsOpen : own;
  const setAlerts = (v: boolean) => (controlled ? onAlerts?.(v) : setOwn(v));

  useEffect(() => {
    if (!alerts) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAlerts(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts]);

  return (
    <header style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', zIndex: 20, ...style }}>
      <div style={{ flex: 1, minWidth: 0 }}>{center}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {search}
        <UserPill />
        <BellButton open={alerts} onToggle={() => setAlerts(!alerts)} glass={glass} />
      </div>
      {alerts && !controlled && <AlertsPanel onClose={() => setAlerts(false)} style={{ position: 'absolute', top: 60, right: 0 }} />}
    </header>
  );
}

/** Ramme for sidene med kystbakgrunn: ikonmeny, topplinje og innhold. */
export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <Sidebar />
      <div className="page">
        <img className="page-bg" src="/kyst.jpg" alt="" />
        <div className="page-veil" aria-hidden="true" />
        <Topbar style={{ padding: '24px 32px 0' }} />
        <main className="page-main">{children}</main>
      </div>
    </div>
  );
}
