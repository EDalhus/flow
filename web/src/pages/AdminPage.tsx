import { useState, type ReactNode } from 'react';
import type { Quay, Theme, UserView } from '../../../shared/api.ts';
import { CREW_ROLES, CREW_ROLE_LABEL, USER_ROLES, type CrewRole, type UserRole } from '../../../shared/domain/types.ts';
import { Plus } from '../components/Icons.tsx';
import { Page } from '../components/Topbar.tsx';
import { Loading, QuayMark, Segmented } from '../components/ui.tsx';
import { errorText } from '../lib/api.ts';
import { ROLE_NAMES, quayTitle } from '../lib/format.ts';
import { LANGS, tr, tx } from '../lib/i18n.ts';
import { LangFlag } from '../components/Flag.tsx';
import { useAllQuays, useAllUsers, useMe, useSavePrefs, useSaveQuay, useSaveUser } from '../lib/queries.ts';

const roleLabel = (r: UserRole) => tr(ROLE_NAMES[r]);
type Tab = 'brukere' | 'kaier' | 'preferanser';

/** Innstillinger: egne preferanser for alle, og kaier og brukere (egne + nabobedrifter) for admin. */
export function AdminPage() {
  const me = useMe();
  const admin = !!me.data?.roles.includes('admin');
  const [tab, setTab] = useState<Tab>(admin ? 'kaier' : 'preferanser');
  const shown = admin ? tab : 'preferanser';

  return (
    <Page>
      <div style={{ flex: '999 1 640px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 className="page-title">{tr('Innstillinger')}</h1>
            <span className="muted">{tr('Dine valg for Flow. Admin styrer også kaier og brukere.')}</span>
          </div>
          {admin && (
            <Segmented label={tr('Innstillinger')} value={tab} onChange={setTab}
              options={[{ value: 'kaier', label: tr('Kaier') }, { value: 'brukere', label: tr('Brukere') }, { value: 'preferanser', label: tr('Preferanser') }]} />
          )}
        </div>
        {shown === 'brukere' ? <UsersSection /> : shown === 'kaier' ? <QuaysSection /> : <PrefsSection />}
      </div>
    </Page>
  );
}

const TIMELINE: { value: 1 | 3 | 7 | 14; label: () => string }[] = [
  { value: 1, label: () => tr('24 t') }, { value: 3, label: () => tr('{n} d', { n: 3 }) }, { value: 7, label: () => tr('{n} d', { n: 7 }) }, { value: 14, label: () => tr('{n} d', { n: 14 }) },
];

/** Brukerens egne valg: tema, språk og kaiplan. Lagres på brukeren med en gang. */
function PrefsSection() {
  const me = useMe();
  const save = useSavePrefs();
  const prefs = me.data?.prefs ?? {};
  const row = (title: string, note: string | null, control: ReactNode) => (
    <div className="pref-row">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 17 }}>{title}</span>
        {note && <span className="muted" style={{ fontSize: 13 }}>{note}</span>}
      </div>
      {control}
    </div>
  );
  return (
    <section className="glass" style={{ maxWidth: 820, padding: '6px 22px' }} aria-label={tr('Preferanser')}>
      <p className="muted" style={{ margin: '14px 0 4px', fontSize: 14 }}>{tr('Valgene gjelder bare deg, og følger deg på PC og telefon.')}</p>
      {row(tr('Tema'), null,
        <Segmented<Theme> label={tr('Tema')} value={prefs.theme ?? 'mork'} onChange={v => save.mutate({ theme: v })}
          options={[{ value: 'mork', label: tr('Mørk') }, { value: 'lys', label: tr('Lys') }, { value: 'system', label: tr('Følg maskinen') }]} />)}
      {row(tr('Språk'), null,
        <div role="group" aria-label={tr('Språk')} className="pill seg" style={{ flexWrap: 'wrap', borderRadius: 22 }}>
          {LANGS.map(l => (
            <button key={l.value} type="button" className="tab" lang={l.value === 'nb' ? 'no' : l.value} aria-pressed={(prefs.lang ?? 'nb') === l.value}
              onClick={() => save.mutate({ lang: l.value })} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <LangFlag lang={l.value} />{l.label}
            </button>
          ))}
        </div>)}
      {row(tr('Kaiplan på kartet'), tr('Hvor langt fram kaiplanen nederst på kartet viser.'),
        <div role="group" aria-label={tr('Kaiplan på kartet')} className="pill seg">
          {TIMELINE.map(o => (
            <button key={o.value} type="button" className="tab" aria-pressed={(prefs.timeline_days ?? 7) === o.value} onClick={() => save.mutate({ timeline_days: o.value })}>{o.label()}</button>
          ))}
        </div>)}
      {save.isError && <div className="error-box" style={{ marginBottom: 14 }}>{errorText(save.error)}</div>}
    </section>
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
            <Plus size={16} strokeWidth={2.2} />{tr('Ny bruker')}
          </button>
        </div>
        <section className="glass" style={{ overflow: 'hidden' }}>
          {users.isPending && <Loading />}
          {(users.data ?? []).map(u => (
            <button key={u.id} type="button" onClick={() => setEditing(u)}
              style={{ width: '100%', textAlign: 'left', cursor: 'pointer', display: 'grid', gridTemplateColumns: '46px minmax(160px, 1.2fr) minmax(180px, 1.4fr) minmax(160px, 1fr)', gap: 14, alignItems: 'center', padding: '12px 18px', background: 'transparent', border: 'none', borderTop: '1px solid rgba(var(--tint), .05)', opacity: u.active ? 1 : .5 }}>
              <span style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(var(--tint), .08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>{u.initials}</span>
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span>{u.name} <span className="muted" style={{ fontSize: 13 }}>· {u.short_name}</span></span>
                <span className="muted" style={{ fontSize: 13 }}>{u.email}{u.active ? '' : ` · ${tr('deaktivert')}`}</span>
              </span>
              <span style={{ fontSize: 14 }}>{u.roles.map(roleLabel).join(', ') || '–'}</span>
              <span className="muted" style={{ fontSize: 13 }}>{u.skills.map(s => tx(CREW_ROLE_LABEL[s])).join(', ') || '–'}</span>
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
          <span className="muted" style={{ fontSize: 14 }}>{tr('Egne kaier og kaier hos nabobedrifter dere låner plass hos.')}</span>
          <button type="button" className="btn btn-w" onClick={() => setEditing('ny')} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 46 }}>
            <Plus size={16} strokeWidth={2.2} />{tr('Ny kai')}
          </button>
        </div>
        <section className="glass" style={{ overflow: 'hidden' }}>
          {quays.isPending && <Loading />}
          {own.length > 0 && <GroupLabel>{tr('Våre kaier')}</GroupLabel>}
          {own.map(q => <QuayRow key={q.id} quay={q} onClick={() => setEditing(q)} />)}
          {partners.length > 0 && <GroupLabel>{tr('Samarbeid')}</GroupLabel>}
          {partners.map(q => <QuayRow key={q.id} quay={q} onClick={() => setEditing(q)} />)}
          {!quays.isPending && !list.length && (
            <p style={{ margin: 0, padding: 18, color: 'var(--fg-62)' }}>{tr('Ingen kaier ennå. Legg til egne eller hos naboer.')}</p>
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
  return <div style={{ padding: '10px 18px 4px', fontSize: 12, color: 'var(--fg-55)', borderTop: '1px solid rgba(var(--tint), .05)' }}>{children}</div>;
}

function QuayRow({ quay, onClick }: { quay: Quay; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      style={{ width: '100%', textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', padding: '12px 18px', background: 'transparent', border: 'none', borderTop: '1px solid rgba(var(--tint), .05)', opacity: quay.active ? 1 : .5 }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <QuayMark quay={quay} />
        <span className="muted" style={{ fontSize: 13 }}>
          {quay.name}{quay.nickname ? ` · ${tr('kallenavn «{navn}»', { navn: quay.nickname })}` : ''}
          {quay.lat != null && quay.lon != null ? ` · ${quay.lat.toFixed(4)}, ${quay.lon.toFixed(4)}` : ''}
          {quay.active ? '' : ` · ${tr('deaktivert')}`}
        </span>
      </span>
      <span className="muted" style={{ fontSize: 13, flex: 'none' }}>#{quay.sort}</span>
    </button>
  );
}

function QuayForm({ quay, onDone }: { quay?: Quay; onDone: () => void }) {
  const save = useSaveQuay();
  const [f, setF] = useState({
    name: quay?.name ?? '',
    nickname: quay?.nickname ?? '',
    company: quay?.company ?? '',
    sort: quay?.sort ?? '',
    lat: quay?.lat != null ? String(quay.lat) : '',
    lon: quay?.lon != null ? String(quay.lon) : '',
    active: quay?.active ?? true,
  });
  const preview = { name: f.name.trim() || tr('Kai'), nickname: f.nickname.trim() || null, company: f.company.trim() || null };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      name: f.name.trim(),
      nickname: f.nickname.trim() || null,
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
      <h2 style={{ margin: 0, fontSize: 24, fontWeight: 300 }}>{quay ? quayTitle(quay) : tr('Ny kai')}</h2>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--fg-62)' }}>
        {tr('Formelt navn er Kai 1 / Kai 2. Kallenavnet er det som vises overalt i appen. La bedrift stå tom for egne kaier.')}
      </p>
      <label className="field"><span>{tr('Formelt navn')}</span>
        <input className="inp" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required placeholder="Kai 1" />
      </label>
      <label className="field"><span>{tr('Kallenavn (vises i UI)')}</span>
        <input className="inp" value={f.nickname} onChange={e => setF({ ...f, nickname: e.target.value })} placeholder={tr('F.eks. Ytre, Indre')} />
      </label>
      <label className="field"><span>{tr('Bedrift (tom = vår egen)')}</span>
        <input className="inp" value={f.company} onChange={e => setF({ ...f, company: e.target.value })} placeholder={tr('F.eks. Ålesund Fiskemottak')} />
      </label>
      <label className="field"><span>{tr('Sortering')}</span>
        <input className="inp n" type="number" min={0} value={f.sort} onChange={e => setF({ ...f, sort: e.target.value })} placeholder={tr('Automatisk')} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field"><span>{tr('Breddegrad')}</span>
          <input className="inp n" value={f.lat} onChange={e => setF({ ...f, lat: e.target.value })} placeholder="62.479" inputMode="decimal" />
        </label>
        <label className="field"><span>{tr('Lengdegrad')}</span>
          <input className="inp n" value={f.lon} onChange={e => setF({ ...f, lon: e.target.value })} placeholder="6.193" inputMode="decimal" />
        </label>
      </div>
      <div style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(var(--tint), .04)', border: '1px solid rgba(var(--tint), .07)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--fg-55)' }}>{tr('Slik det vises')}</span>
        <QuayMark quay={preview} />
      </div>
      {quay && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} style={{ width: 18, height: 18, accentColor: '#F2F5F3' }} />
          {tr('Aktiv (kan velges på anløp)')}
        </label>
      )}
      {save.isError && <div className="error-box" role="alert">{errorText(save.error)}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-w" disabled={!f.name.trim() || save.isPending} style={{ minHeight: 46 }}>{save.isPending ? tr('Lagrer …') : tr('Lagre')}</button>
        <button type="button" className="btn" onClick={onDone} style={{ minHeight: 46 }}>{tr('Avbryt')}</button>
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
      <h2 style={{ margin: 0, fontSize: 24, fontWeight: 300 }}>{user ? user.name : tr('Ny bruker')}</h2>
      <label className="field"><span>{tr('E-post (samme som i Cloudflare Access)')}</span>
        <input className="inp" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} required />
      </label>
      <label className="field"><span>{tr('Fullt navn')}</span><input className="inp" value={f.name} onChange={e => onName(e.target.value)} required /></label>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
        <label className="field"><span>{tr('Kortnavn (for @-tagging)')}</span><input className="inp" value={f.short_name} onChange={e => setF({ ...f, short_name: e.target.value })} required minLength={2} /></label>
        <label className="field"><span>{tr('Initialer')}</span><input className="inp" value={f.initials} onChange={e => setF({ ...f, initials: e.target.value.toUpperCase() })} required maxLength={4} /></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field"><span>{tr('Tittel')}</span><input className="inp" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder={tr('Formann kai')} /></label>
        <label className="field"><span>{tr('Telefon')}</span><input className="inp" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} inputMode="tel" /></label>
      </div>
      <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <legend className="lbl" style={{ marginBottom: 6 }}>{tr('Roller')}</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {USER_ROLES.map(r => (
            <button key={r} type="button" className="tab" aria-pressed={f.roles.includes(r)} disabled={isMe && r === 'admin'}
              onClick={() => setF({ ...f, roles: toggle(f.roles, r) })} style={{ border: '1px solid rgba(var(--tint), .1)' }}>{roleLabel(r)}</button>
          ))}
        </div>
      </fieldset>
      <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <legend className="lbl" style={{ marginBottom: 6 }}>{tr('Kan stå som (mannskap)')}</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {CREW_ROLES.map(r => (
            <button key={r} type="button" className="tab" aria-pressed={f.skills.includes(r)}
              onClick={() => setF({ ...f, skills: toggle(f.skills, r) })} style={{ border: '1px solid rgba(var(--tint), .1)' }}>{tx(CREW_ROLE_LABEL[r])}</button>
          ))}
        </div>
      </fieldset>
      {user && !isMe && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} style={{ width: 18, height: 18, accentColor: '#F2F5F3' }} />
          {tr('Aktiv (kan logge inn)')}
        </label>
      )}
      <span style={{ fontSize: 12, color: 'var(--fg-55)' }}>
        {tr('Husk at e-posten også må slippes inn av Access-policyen i Cloudflare Zero Trust.')}
      </span>
      {save.isError && <div className="error-box" role="alert">{errorText(save.error)}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-w" disabled={!f.roles.length || save.isPending} style={{ minHeight: 46 }}>{save.isPending ? tr('Lagrer …') : tr('Lagre')}</button>
        <button type="button" className="btn" onClick={onDone} style={{ minHeight: 46 }}>{tr('Avbryt')}</button>
      </div>
    </form>
  );
}
