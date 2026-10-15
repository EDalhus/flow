import { useState } from 'react';
import { Navigate } from 'react-router';
import type { Quay, UserView } from '../../../shared/api.ts';
import { CREW_ROLES, CREW_ROLE_LABEL, USER_ROLES, type CrewRole, type UserRole } from '../../../shared/domain/types.ts';
import { Plus } from '../components/Icons.tsx';
import { Page } from '../components/Topbar.tsx';
import { Loading, Segmented } from '../components/ui.tsx';
import { errorText } from '../lib/api.ts';
import { quayLabel } from '../lib/format.ts';
import { useAllQuays, useAllUsers, useMe, useSaveQuay, useSaveUser } from '../lib/queries.ts';

const ROLE_LABEL: Record<UserRole, string> = { salg: 'Salg', produksjon: 'Produksjon', kaiarbeider: 'Kaiarbeider', admin: 'Admin' };
type Tab = 'brukere' | 'kaier';

/** Brukere og kaier (egne + nabobedrifter). Bare for admin. */
export function AdminPage() {
  const me = useMe();
  const [tab, setTab] = useState<Tab>('kaier');
  if (me.data && !me.data.roles.includes('admin')) return <Navigate to="/" replace />;

  return (
    <Page>
      <div style={{ flex: '999 1 640px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 className="page-title">Administrasjon</h1>
            <span className="muted">Brukere, roller og kaier – også hos nabobedrifter dere samarbeider med.</span>
          </div>
          <Segmented label="Seksjon" value={tab} onChange={setTab}
            options={[{ value: 'kaier', label: 'Kaier' }, { value: 'brukere', label: 'Brukere' }]} />
        </div>
        {tab === 'brukere' ? <UsersSection /> : <QuaysSection />}
      </div>
    </Page>
  );
}

function UsersSection() {
  const me = useMe();
  const users = useAllUsers();
  const [editing, setEditing] = useState<UserView | 'ny' | null>(null);

  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: '999 1 480px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-w" onClick={() => setEditing('ny')} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 46 }}>
            <Plus size={16} strokeWidth={2.2} />Ny bruker
          </button>
        </div>
        <section className="glass" style={{ overflow: 'hidden' }}>
          {users.isPending && <Loading />}
          {(users.data ?? []).map(u => (
            <button key={u.id} type="button" onClick={() => setEditing(u)}
              style={{ width: '100%', textAlign: 'left', cursor: 'pointer', display: 'grid', gridTemplateColumns: '46px minmax(160px, 1.2fr) minmax(180px, 1.4fr) minmax(160px, 1fr)', gap: 14, alignItems: 'center', padding: '12px 18px', background: 'transparent', border: 'none', borderTop: '1px solid rgba(255,255,255,.05)', opacity: u.active ? 1 : .5 }}>
              <span style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>{u.initials}</span>
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span>{u.name} <span className="muted" style={{ fontSize: 13 }}>· {u.short_name}</span></span>
                <span className="muted" style={{ fontSize: 13 }}>{u.email}{u.active ? '' : ' · deaktivert'}</span>
              </span>
              <span style={{ fontSize: 14 }}>{u.roles.map(r => ROLE_LABEL[r]).join(', ') || '–'}</span>
              <span className="muted" style={{ fontSize: 13 }}>{u.skills.map(s => CREW_ROLE_LABEL[s]).join(', ') || '–'}</span>
            </button>
          ))}
        </section>
      </div>
      {editing && (
        <aside className="glass scroll" style={{ flex: '1 1 360px', maxWidth: 420, padding: 20, maxHeight: 'calc(100vh - 120px)', position: 'sticky', top: 20 }}>
          <UserForm key={editing === 'ny' ? 'ny' : editing.id} user={editing === 'ny' ? undefined : editing} isMe={editing !== 'ny' && editing.id === me.data?.id} onDone={() => setEditing(null)} />
        </aside>
      )}
    </div>
  );
}

function QuaysSection() {
  const quays = useAllQuays();
  const [editing, setEditing] = useState<Quay | 'ny' | null>(null);
  const list = quays.data ?? [];
  const own = list.filter(q => !q.company);
  const partners = list.filter(q => q.company);

  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: '999 1 480px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 14 }}>Egne kaier og kaier hos nabobedrifter dere låner plass hos.</span>
          <button type="button" className="btn btn-w" onClick={() => setEditing('ny')} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 46 }}>
            <Plus size={16} strokeWidth={2.2} />Ny kai
          </button>
        </div>
        <section className="glass" style={{ overflow: 'hidden' }}>
          {quays.isPending && <Loading />}
          {own.length > 0 && <GroupLabel>Våre kaier</GroupLabel>}
          {own.map(q => <QuayRow key={q.id} quay={q} onClick={() => setEditing(q)} />)}
          {partners.length > 0 && <GroupLabel>Samarbeid</GroupLabel>}
          {partners.map(q => <QuayRow key={q.id} quay={q} onClick={() => setEditing(q)} />)}
          {!quays.isPending && !list.length && (
            <p style={{ margin: 0, padding: 18, color: 'var(--fg-62)' }}>Ingen kaier ennå. Legg til egne eller hos naboer.</p>
          )}
        </section>
      </div>
      {editing && (
        <aside className="glass scroll" style={{ flex: '1 1 360px', maxWidth: 420, padding: 20, maxHeight: 'calc(100vh - 120px)', position: 'sticky', top: 20 }}>
          <QuayForm key={editing === 'ny' ? 'ny' : editing.id} quay={editing === 'ny' ? undefined : editing} onDone={() => setEditing(null)} />
        </aside>
      )}
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '10px 18px 4px', fontSize: 12, color: 'var(--fg-55)', borderTop: '1px solid rgba(255,255,255,.05)' }}>{children}</div>;
}

function QuayRow({ quay, onClick }: { quay: Quay; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      style={{ width: '100%', textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', padding: '12px 18px', background: 'transparent', border: 'none', borderTop: '1px solid rgba(255,255,255,.05)', opacity: quay.active ? 1 : .5 }}>
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span>{quayLabel(quay)}</span>
        <span className="muted" style={{ fontSize: 13 }}>
          {quay.company ? 'Nabobedrift' : 'Egen kai'}
          {quay.lat != null && quay.lon != null ? ` · ${quay.lat.toFixed(4)}, ${quay.lon.toFixed(4)}` : ''}
          {quay.active ? '' : ' · deaktivert'}
        </span>
      </span>
      <span className="muted" style={{ fontSize: 13 }}>#{quay.sort}</span>
    </button>
  );
}

function QuayForm({ quay, onDone }: { quay?: Quay; onDone: () => void }) {
  const save = useSaveQuay();
  const [f, setF] = useState({
    name: quay?.name ?? '',
    company: quay?.company ?? '',
    sort: quay?.sort ?? '',
    lat: quay?.lat != null ? String(quay.lat) : '',
    lon: quay?.lon != null ? String(quay.lon) : '',
    active: quay?.active ?? true,
  });
  const partner = f.company.trim().length > 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      name: f.name.trim(),
      company: f.company.trim() || null,
      sort: f.sort === '' ? undefined : Number(f.sort),
      lat: f.lat === '' ? null : Number(f.lat),
      lon: f.lon === '' ? null : Number(f.lon),
      ...(quay ? { active: f.active } : {}),
    };
    save.mutate({ id: quay?.id, body }, { onSuccess: onDone });
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 24, fontWeight: 300 }}>{quay ? quayLabel(quay) : 'Ny kai'}</h2>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--fg-62)' }}>
        La bedrift stå tom for egne kaier. Fyll inn nabobedrift når dere samarbeider om kaiplass.
      </p>
      <label className="field"><span>Navn på kai</span>
        <input className="inp" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required placeholder="Kai 1" />
      </label>
      <label className="field"><span>Bedrift (tom = vår egen)</span>
        <input className="inp" value={f.company} onChange={e => setF({ ...f, company: e.target.value })} placeholder="F.eks. Nabo AS" />
      </label>
      <label className="field"><span>Sortering</span>
        <input className="inp n" type="number" min={0} value={f.sort} onChange={e => setF({ ...f, sort: e.target.value })} placeholder="Automatisk" />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field"><span>Breddegrad</span>
          <input className="inp n" value={f.lat} onChange={e => setF({ ...f, lat: e.target.value })} placeholder="62.479" inputMode="decimal" />
        </label>
        <label className="field"><span>Lengdegrad</span>
          <input className="inp n" value={f.lon} onChange={e => setF({ ...f, lon: e.target.value })} placeholder="6.193" inputMode="decimal" />
        </label>
      </div>
      {partner && (
        <span style={{ fontSize: 12, color: 'var(--fg-55)' }}>
          Vises som «{f.name.trim() || 'Kai'} · {f.company.trim()}» i anløp og på kartet.
        </span>
      )}
      {quay && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} style={{ width: 18, height: 18, accentColor: '#F3F5F6' }} />
          Aktiv (kan velges på anløp)
        </label>
      )}
      {save.isError && <div className="error-box" role="alert">{errorText(save.error)}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-w" disabled={!f.name.trim() || save.isPending} style={{ minHeight: 46 }}>{save.isPending ? 'Lagrer …' : 'Lagre'}</button>
        <button type="button" className="btn" onClick={onDone} style={{ minHeight: 46 }}>Avbryt</button>
      </div>
    </form>
  );
}

function UserForm({ user, isMe, onDone }: { user?: UserView; isMe: boolean; onDone: () => void }) {
  const save = useSaveUser();
  const [f, setF] = useState({
    email: user?.email ?? '', name: user?.name ?? '', short_name: user?.short_name ?? '', initials: user?.initials ?? '',
    title: user?.title ?? '', phone: user?.phone ?? '', roles: user?.roles ?? (['kaiarbeider'] as UserRole[]),
    skills: user?.skills ?? ([] as CrewRole[]), active: user?.active ?? true,
  });
  const onName = (name: string) => {
    const parts = name.trim().split(/\s+/);
    const short = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] ?? '';
    const ini = parts.map(p => p[0] ?? '').join('').slice(0, 2).toUpperCase();
    setF(x => ({ ...x, name, ...(user ? {} : { short_name: short, initials: ini }) }));
  };
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...f, title: f.title || null, phone: f.phone || null, ...(user ? {} : { active: undefined }) };
    save.mutate({ id: user?.id, body }, { onSuccess: onDone });
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 24, fontWeight: 300 }}>{user ? user.name : 'Ny bruker'}</h2>
      <label className="field"><span>E-post (samme som i Cloudflare Access)</span>
        <input className="inp" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} required />
      </label>
      <label className="field"><span>Fullt navn</span><input className="inp" value={f.name} onChange={e => onName(e.target.value)} required /></label>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
        <label className="field"><span>Kortnavn (for @-tagging)</span><input className="inp" value={f.short_name} onChange={e => setF({ ...f, short_name: e.target.value })} required minLength={2} /></label>
        <label className="field"><span>Initialer</span><input className="inp" value={f.initials} onChange={e => setF({ ...f, initials: e.target.value.toUpperCase() })} required maxLength={4} /></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field"><span>Tittel</span><input className="inp" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="Formann kai" /></label>
        <label className="field"><span>Telefon</span><input className="inp" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} inputMode="tel" /></label>
      </div>
      <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <legend className="lbl" style={{ marginBottom: 6 }}>Roller</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {USER_ROLES.map(r => (
            <button key={r} type="button" className="tab" aria-pressed={f.roles.includes(r)} disabled={isMe && r === 'admin'}
              onClick={() => setF({ ...f, roles: toggle(f.roles, r) })} style={{ border: '1px solid rgba(255,255,255,.1)' }}>{ROLE_LABEL[r]}</button>
          ))}
        </div>
      </fieldset>
      <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <legend className="lbl" style={{ marginBottom: 6 }}>Kan stå som (mannskap)</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {CREW_ROLES.map(r => (
            <button key={r} type="button" className="tab" aria-pressed={f.skills.includes(r)}
              onClick={() => setF({ ...f, skills: toggle(f.skills, r) })} style={{ border: '1px solid rgba(255,255,255,.1)' }}>{CREW_ROLE_LABEL[r]}</button>
          ))}
        </div>
      </fieldset>
      {user && !isMe && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} style={{ width: 18, height: 18, accentColor: '#F3F5F6' }} />
          Aktiv (kan logge inn)
        </label>
      )}
      <span style={{ fontSize: 12, color: 'var(--fg-55)' }}>
        Husk at e-posten også må slippes inn av Access-policyen i Cloudflare Zero Trust.
      </span>
      {save.isError && <div className="error-box" role="alert">{errorText(save.error)}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-w" disabled={!f.roles.length || save.isPending} style={{ minHeight: 46 }}>{save.isPending ? 'Lagrer …' : 'Lagre'}</button>
        <button type="button" className="btn" onClick={onDone} style={{ minHeight: 46 }}>Avbryt</button>
      </div>
    </form>
  );
}
