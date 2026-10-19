import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { CallRef, CollisionView, LogCall, OrderDetail, OrderLogEntry, OrderStatus, PortCallView } from '../../../shared/api.ts';
import { CREW_ROLES, CREW_ROLE_LABEL, FLAG_LABEL, type CrewRole } from '../../../shared/domain/types.ts';
import type { OrderLineInput, Placement } from '../../../shared/schemas.ts';
import { osloToUtc } from '../../../shared/time.ts';
import { api, errorText } from '../lib/api.ts';
import { FLAG_STYLE, addDays, dayShort, ddmm, fr, hmFromIso, nb, osloTime, quayLabel, quayTitle, timeRange, todayOslo } from '../lib/format.ts';
import { tr, tx } from '../lib/i18n.ts';
import {
  useAssignOrder, useBoats, useCancelOrder, useCancelPortCall, useCreateOrder, useMe, useOrder, usePatchOrder, usePortCalls,
  useProducts, useQuays, useUsers, type OrderChange, type Sku,
} from '../lib/queries.ts';
import { Close, Minus, Plus } from './Icons.tsx';
import { Loading, QuayMark, Segmented, StatusBadge } from './ui.tsx';

// Salgsordre (SO): status, endringslogg, detaljpanel med flytting mellom båter, og skjema for ny ordre.

// ---------------------------------------------------------------- status

const STATUS: Record<OrderStatus, { label: string; c: string; bg: string }> = {
  venter: { label: 'Venter på båt', c: 'var(--warn-fg)', bg: 'rgba(247,185,85,.16)' },
  planlagt: { label: 'På båt', c: 'var(--aqua)', bg: 'rgba(128,239,222,.14)' },
  delvis: { label: 'Delvis på båt', c: 'var(--warn-fg)', bg: 'rgba(247,185,85,.16)' },
  ferdig: { label: 'Ferdig', c: 'var(--fg-62)', bg: 'rgba(var(--tint), .08)' },
  kansellert: { label: 'Kansellert', c: 'var(--fg-55)', bg: 'rgba(var(--tint), .06)' },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const s = STATUS[status];
  return (
    <span className="badge" style={{ background: s.bg, color: s.c, fontSize: 12 } as CSSProperties}>
      <span className="dot" style={{ background: 'currentColor' }} />{tr(s.label)}
    </span>
  );
}

/** «SO 2043644» i fast bredde. */
export const SoNo = ({ n, style }: { n: string; style?: CSSProperties }) => (
  <span className="n" style={{ fontWeight: 500, letterSpacing: '.02em', ...style }}>SO {n}</span>
);

// ---------------------------------------------------------------- endringslogg

const when = (eta: string, known: boolean) => `${dayShort(serviceDay(eta))}${known ? ` ${osloTime(eta)}` : ` (${tr('tid ikke satt')})`}`;
const serviceDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
const callText = (c: LogCall | null | undefined) => (c ? `${c.boat} · ${when(c.eta, c.time_known)} · ${c.quay}` : '–');
const etaText = (v: unknown) => { const e = v as { eta: string; time_known: boolean } | undefined; return e ? when(e.eta, e.time_known) : '–'; };
const s = (v: unknown) => (v == null || v === '' ? '–' : String(v));
const goods = (v: unknown) => (Array.isArray(v) ? v.map(x => tx(String(x))).join(', ') : tx(s(v)));

/** Én linje i loggen, på brukerens språk. */
export function logText(e: OrderLogEntry): string {
  const d = e.data;
  switch (e.kind) {
    case 'created': return tr('Opprettet SO {so}', { so: s(d.so_number) });
    case 'line_added': return tr('La til {vare}', { vare: goods(d.line) });
    case 'line_removed': return tr('Fjernet {vare}', { vare: goods(d.line) });
    case 'line_changed': return tr('Endret vare: {fra} → {til}', { fra: goods(d.from), til: goods(d.to) });
    case 'customer': return tr('Kunde: {fra} → {til}', { fra: s(d.from), til: s(d.to) });
    case 'seller': return tr('Selger: {fra} → {til}', { fra: s(d.from), til: s(d.to) });
    case 'wanted_date': return tr('Ønsket dag: {fra} → {til}', { fra: d.from ? dayShort(String(d.from)) : '–', til: d.to ? dayShort(String(d.to)) : '–' });
    case 'notes': return tr('Endret merknad');
    case 'assigned':
      return d.lines ? tr('La {varer} på {anløp}', { varer: goods(d.lines), anløp: callText(d.to as LogCall) }) : tr('Lagt på {anløp}', { anløp: callText(d.to as LogCall) });
    case 'moved':
      return d.lines
        ? tr('Flyttet {varer} fra {fra} til {til}', { varer: goods(d.lines), fra: callText(d.from as LogCall), til: callText(d.to as LogCall) })
        : tr('Flyttet fra {fra} til {til}', { fra: callText(d.from as LogCall), til: callText(d.to as LogCall) });
    case 'unassigned':
      if (d.reason) return tr('Tatt av båten fordi anløpet ble avlyst: {anløp} ({grunn})', { anløp: callText(d.from as LogCall), grunn: s(d.reason) });
      return d.lines ? tr('Tok {varer} av båten ({anløp})', { varer: goods(d.lines), anløp: callText(d.from as LogCall) }) : tr('Tatt av båten ({anløp})', { anløp: callText(d.from as LogCall) });
    case 'boat_changed': return tr('Byttet båt: {fra} → {til}', { fra: s(d.from), til: s(d.to) });
    case 'eta_changed': return tr('Ny ETA: {fra} → {til}', { fra: etaText(d.from), til: etaText(d.to) });
    case 'quay_changed': return tr('Ny kai: {fra} → {til}', { fra: s(d.from), til: s(d.to) });
    case 'load_order': return tr('Lasterekkefølge: nr. {fra} → nr. {til}', { fra: s(d.from), til: s(d.to) });
    case 'cancelled': return tr('Kansellert: {grunn}', { grunn: s(d.reason) });
    case 'completed': return tr('Ferdig – kaibok levert ({båt})', { båt: s(d.boat) });
    default: return e.kind;
  }
}

/** Tidslinje: hvem, når og hva. `showSo` viser SO-nummeret (loggen for et anløp). */
export function OrderLog({ entries, showSo, onSo }: { entries: OrderLogEntry[]; showSo?: boolean; onSo?: (so: string) => void }) {
  if (!entries.length) return <p className="muted" style={{ margin: 0, fontSize: 14 }}>{tr('Ingen endringer ennå.')}</p>;
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
      {entries.map(e => (
        <li key={e.id} style={{ display: 'grid', gridTemplateColumns: '78px 1fr', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line-soft)', fontSize: 13 }}>
          <span className="n" style={{ color: 'var(--fg-55)', lineHeight: 1.35 }}>{ddmm(e.at)} {osloTime(e.at)}</span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
            <span style={{ color: 'var(--fg-85)' }}>
              {showSo && e.so_number && (
                <button type="button" onClick={() => onSo?.(e.so_number!)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--aqua)', cursor: onSo ? 'pointer' : 'default', font: 'inherit', marginRight: 6 }}>
                  SO {e.so_number}
                </button>
              )}
              {logText(e)}
            </span>
            <span style={{ fontSize: 12, color: 'var(--fg-55)' }}>{e.user?.short_name ?? 'Flow'}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- varelinjer

export type LineDraft = { id?: string; sku_id: string; quantity: string; direction: 'inn' | 'ut'; locked?: boolean };
type SkuOption = Sku & { name: string };

const skuLabel = (s: SkuOption) =>
  s.unit === 'BB' ? `${s.name} – BB` : `${s.name} – 25 kg × ${s.bags_per_unit} · ${s.pallet_type === 'srs' ? tr('SRS-pall') : tr('Europall')}`;

function useSkus(): SkuOption[] {
  const products = useProducts();
  return useMemo(() => (products.data ?? []).flatMap(p => p.skus.map(s => ({ ...s, name: p.name }))), [products.data]);
}

/** Varelinjer: produkt, antall og retning. Levert vare (locked) kan ikke endres. */
function LinesEditor({ lines, onChange, defaultDirection }: { lines: LineDraft[]; onChange: (l: LineDraft[]) => void; defaultDirection: 'inn' | 'ut' }) {
  const skus = useSkus();
  const set = (i: number, p: Partial<LineDraft>) => onChange(lines.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const tonnes = lines.reduce((t, l) => { const s = skus.find(x => x.id === (l.sku_id || skus[0]?.id)); return t + (s ? (Number(l.quantity) || 0) * s.kg_per_unit / 1000 : 0); }, 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {lines.map((l, i) => (
        <div key={l.id ?? `n${i}`} style={{ display: 'grid', gridTemplateColumns: '96px minmax(0, 1fr) 40px', gap: 6, alignItems: 'center', opacity: l.locked ? .6 : 1, paddingBottom: 6, borderBottom: '1px solid var(--line-soft)' }}>
          <label style={{ gridColumn: '1 / -1' }}><span className="sr">{tr('Produkt')}</span>
            <select className="inp" disabled={l.locked} value={l.sku_id || skus[0]?.id || ''} onChange={e => set(i, { sku_id: e.target.value })}>
              <optgroup label={tr('Bigbag (BB) 1000 kg')}>{skus.filter(s => s.unit === 'BB').map(s => <option key={s.id} value={s.id}>{skuLabel(s)}</option>)}</optgroup>
              <optgroup label={tr('Sekk på pall')}>{skus.filter(s => s.unit === 'pall').map(s => <option key={s.id} value={s.id}>{skuLabel(s)}</option>)}</optgroup>
            </select>
          </label>
          <label><span className="sr">{tr('Antall')}</span>
            <input className="inp n" disabled={l.locked} inputMode="numeric" value={l.quantity} placeholder={tr('Antall')} onChange={e => set(i, { quantity: e.target.value.replace(/\D/g, '') })} />
          </label>
          <select className="inp" aria-label={tr('Retning')} disabled={l.locked} value={l.direction} onChange={e => set(i, { direction: e.target.value as 'inn' | 'ut' })} style={{ padding: '0 8px' }}>
            <option value="ut">{tr('Henting')}</option>
            <option value="inn">{tr('Levering')}</option>
          </select>
          {!l.locked && lines.length > 1
            ? <button type="button" className="icon-btn pill" aria-label={tr('Fjern varelinje')} onClick={() => onChange(lines.filter((_, j) => j !== i))} style={{ width: 40, height: 40 }}><Close size={13} /></button>
            : <span />}
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn" onClick={() => onChange([...lines, { sku_id: '', quantity: '', direction: defaultDirection }])} style={{ minHeight: 36, fontSize: 13 }}>
          + {tr('Legg til vare')}
        </button>
        <span className="sub n">{tr('Totalt {n} t', { n: nb(tonnes) })}</span>
      </div>
    </div>
  );
}

const toInput = (lines: LineDraft[], skus: SkuOption[]): OrderLineInput[] =>
  lines.filter(l => Number(l.quantity) > 0).map(l => ({ ...(l.id ? { id: l.id } : {}), sku_id: l.sku_id || skus[0]?.id, quantity: Number(l.quantity), direction: l.direction }));

// ---------------------------------------------------------------- hvor SO-en skal (båt)

type Roles = Record<CrewRole, number>;
export type PlaceDraft =
  | { kind: 'none' }
  | { kind: 'call'; port_call_id: string }
  | { kind: 'new'; boat_id: string; quay_id: string; date: string; timeKnown: boolean; eta: string; etd: string; crane: boolean; roles: Roles };

export const newPlace = (date: string): PlaceDraft => ({
  kind: 'new', boat_id: '', quay_id: '', date, timeKnown: false, eta: '12:00', etd: '15:00', crane: true, roles: { truck: 0, anhuker: 0, kaikran: 0 },
});

function toPlacement(p: PlaceDraft, fallbackBoat: string, fallbackQuay: string): Placement | null {
  if (p.kind !== 'new') return p;
  const boat = p.boat_id || fallbackBoat, quay = p.quay_id || fallbackQuay;
  if (!boat || !quay) return null;
  const eta = p.timeKnown ? osloToUtc(p.date, p.eta || '00:00') : osloToUtc(p.date, 0);
  const etd = p.timeKnown ? osloToUtc(p.date, p.etd || '00:00') : osloToUtc(p.date, 23 * 60 + 59);
  if (p.timeKnown && (!/^\d{2}:\d{2}$/.test(p.eta) || !/^\d{2}:\d{2}$/.test(p.etd) || etd <= eta)) return null;
  const crew = CREW_ROLES.flatMap(r => Array.from({ length: p.roles[r] }, () => ({ crew_role: r, user_id: null })));
  return { kind: 'new', call: { boat_id: boat, quay_id: quay, eta, etd, time_known: p.timeKnown, boat_crane: p.crane, crew } };
}

const callOption = (c: PortCallView) =>
  `${c.boat.name} · ${dayShort(c.service_date)} ${c.time_known ? osloTime(c.eta) : `(${tr('tid ikke satt')})`} · ${quayTitle(c.quay)}${c.orders.length ? ` · ${c.orders.length} SO` : ''}`;

/** Velg båt: ingen ennå, et anløp som allerede er planlagt, eller en ny båt (nytt anløp). */
function PlacePicker({ value, onChange, exclude = [], allowNone = true, date }: {
  value: PlaceDraft; onChange: (p: PlaceDraft) => void; exclude?: string[]; allowNone?: boolean; date: string;
}) {
  const today = todayOslo();
  const calls = usePortCalls(today, addDays(today, 30));
  const boats = useBoats();
  const quays = useQuays();
  const open = (calls.data?.calls ?? []).filter(c => !exclude.includes(c.id) && c.status !== 'ferdig' && c.status !== 'avlyst' && !c.has_quay_log);
  const boatList = useMemo(() => [...(boats.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'nb')), [boats.data]);
  const quayList = quays.data ?? [];
  const own = quayList.filter(q => !q.company), partner = quayList.filter(q => q.company);
  const dates = Array.from({ length: 30 }, (_, i) => addDays(today, i));
  const kinds = [...(allowNone ? [{ value: 'none' as const, label: tr('Ingen båt ennå') }] : []), { value: 'call' as const, label: tr('Planlagt båt') }, { value: 'new' as const, label: tr('Ny båt') }];
  const pick = (k: PlaceDraft['kind']) => onChange(k === 'none' ? { kind: 'none' } : k === 'call' ? { kind: 'call', port_call_id: open[0]?.id ?? '' } : newPlace(date));

  // Samme båt og dag som et planlagt anløp: foreslå å legge SO-en der i stedet for et nytt anløp.
  const same = value.kind === 'new' && value.boat_id ? open.find(c => c.boat.id === value.boat_id && c.service_date === value.date) : undefined;
  const boat = value.kind === 'new' ? boatList.find(b => b.id === value.boat_id) ?? boatList[0] : undefined;
  const set = (p: Partial<Extract<PlaceDraft, { kind: 'new' }>>) => value.kind === 'new' && onChange({ ...value, ...p });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Segmented<PlaceDraft['kind']> label={tr('Båt')} value={value.kind} onChange={pick} stretch options={kinds} />
      {value.kind === 'call' && (
        open.length
          ? <select className="inp" aria-label={tr('Planlagt båt')} value={value.port_call_id} onChange={e => onChange({ kind: 'call', port_call_id: e.target.value })}>
              {open.map(c => <option key={c.id} value={c.id}>{callOption(c)}</option>)}
            </select>
          : <span className="sub">{tr('Ingen planlagte anløp de neste 30 dagene.')}</span>
      )}
      {value.kind === 'new' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label className="field"><span>{tr('Båt')}</span>
              <select className="inp" value={boat?.id ?? ''} onChange={e => set({ boat_id: e.target.value })}>
                {boatList.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label className="field"><span>{tr('Kai')}</span>
              <select className="inp" value={value.quay_id || own[0]?.id || ''} onChange={e => set({ quay_id: e.target.value })}>
                <optgroup label={tr('Våre kaier')}>{own.map(q => <option key={q.id} value={q.id}>{quayTitle(q)}</option>)}</optgroup>
                {partner.length > 0 && <optgroup label={tr('Nabo – samarbeid')}>{partner.map(q => <option key={q.id} value={q.id}>{quayLabel(q)}</option>)}</optgroup>}
              </select>
            </label>
          </div>
          {boat && (boat.flag === 'red' || boat.flag === 'yellow') && (
            <div className={boat.flag === 'red' ? 'alert-red' : 'alert-yellow'} style={{ borderRadius: 14, padding: '8px 12px', fontSize: 13 }}>
              <span className="dot" style={{ width: 7, height: 7, background: FLAG_STYLE[boat.flag].dot, marginRight: 6 }} />
              {tx(FLAG_LABEL[boat.flag])} · {boat.flag_reason ? tx(boat.flag_reason) : ''}
            </div>
          )}
          {same && (
            <div className="alert-yellow" style={{ borderRadius: 14, padding: '8px 12px', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ flex: 1 }}>{tr('{båt} har allerede et anløp denne dagen.', { båt: same.boat.name })}</span>
              <button type="button" className="btn" style={{ minHeight: 32, fontSize: 12 }} onClick={() => onChange({ kind: 'call', port_call_id: same.id })}>{tr('Legg SO-en der')}</button>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label className="field"><span>{tr('Dag')}</span>
              <select className="inp" value={value.date} onChange={e => set({ date: e.target.value })}>
                {dates.map(d => <option key={d} value={d}>{dayShort(d)}</option>)}
              </select>
            </label>
            <div className="field"><span>{tr('Klokkeslett')}</span>
              <Segmented label={tr('Klokkeslett')} value={value.timeKnown ? 'ja' : 'nei'} onChange={v => set({ timeKnown: v === 'ja' })} stretch
                options={[{ value: 'nei', label: tr('Ikke kjent') }, { value: 'ja', label: tr('Kjent') }]} />
            </div>
          </div>
          {value.timeKnown && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label className="field"><span>ETA</span><input className="inp n" type="time" value={value.eta} onChange={e => set({ eta: e.target.value })} /></label>
              <label className="field"><span>ETD</span><input className="inp n" type="time" value={value.etd} onChange={e => set({ etd: e.target.value })} /></label>
            </div>
          )}
          <div className="field"><span>{tr('Mannskap (valgfritt – kan legges til senere)')}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {CREW_ROLES.map(r => (
                <span key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 2px 2px 10px', borderRadius: 999, background: 'rgba(var(--tint), .05)', fontSize: 13 }}>
                  {tx(CREW_ROLE_LABEL[r])}
                  <button type="button" className="icon-btn" aria-label={tr('Én {rolle} mindre', { rolle: tx(CREW_ROLE_LABEL[r]).toLowerCase() })} onClick={() => set({ roles: { ...value.roles, [r]: Math.max(0, value.roles[r] - 1) } })} style={{ width: 30, height: 30 }}><Minus size={12} /></button>
                  <span className="n" style={{ width: 14, textAlign: 'center' }}>{value.roles[r]}</span>
                  <button type="button" className="icon-btn" aria-label={tr('Én {rolle} til', { rolle: tx(CREW_ROLE_LABEL[r]).toLowerCase() })} onClick={() => set({ roles: { ...value.roles, [r]: Math.min(10, value.roles[r] + 1) } })} style={{ width: 30, height: 30 }}><Plus size={12} /></button>
                </span>
              ))}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={value.crane} onChange={e => set({ crane: e.target.checked })} style={{ width: 16, height: 16, accentColor: '#F2F5F3' }} />
              {tr('Båtens egen kran brukes')}
            </label>
          </div>
          <CollisionCheck place={value} boat={boat?.id ?? ''} quay={value.quay_id || own[0]?.id || ''} onQuay={q => set({ quay_id: q })} onTimes={(a, b) => set({ timeKnown: true, eta: a, etd: b })} />
        </>
      )}
    </div>
  );
}

/** Kollisjonssjekk for et nytt anløp mens skjemaet fylles ut, med forslag som kan brukes direkte. */
function CollisionCheck({ place, boat, quay, onQuay, onTimes }: {
  place: Extract<PlaceDraft, { kind: 'new' }>; boat: string; quay: string; onQuay: (q: string) => void; onTimes: (eta: string, etd: string) => void;
}) {
  const [check, setCheck] = useState<{ collisions: CollisionView[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const p = toPlacement(place, boat, quay);
  const body = p?.kind === 'new' ? { ...p.call, type: 'levering' } : null;
  const key = JSON.stringify(body);
  useEffect(() => {
    if (!body) { setCheck(null); return; }
    const t = setTimeout(() => {
      api<{ collisions: CollisionView[] }>('/port-calls/check', { body }).then(r => { setCheck(r); setError(null); }).catch(e => setError(errorText(e)));
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!place.timeKnown) return <span className="sub">{tr('Tiden kan settes på anløpet når den er kjent. Kollisjoner sjekkes da.')}</span>;
  let cls = 'alert-ok', title = tr('Ingen kollisjoner – kai og mannskap er ledig');
  if (!p) { cls = 'alert-yellow'; title = tr('ETD må være etter ETA'); }
  else if (error) { cls = 'alert-yellow'; title = error; }
  else if (!check) { cls = ''; title = tr('Sjekker kai og mannskap …'); }
  else if (check.collisions.length) { cls = 'alert-red'; title = tr('Kolliderer med eksisterende anløp'); }
  const sugg = check ? check.collisions.flatMap(c => c.suggestions.filter(x => x.call_id === 'draft')) : [];
  const unique = sugg.filter((x, i) => sugg.findIndex(y => y.text === x.text) === i);
  return (
    <div role="status" className={cls} style={{ borderRadius: 14, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, ...(cls ? {} : { background: 'rgba(var(--tint), .04)' }) }}>
      <span>{title}</span>
      {check?.collisions.map((c, i) => <span key={i} style={{ color: 'var(--fg-75)' }}>{c.with.map(w => w.boat_name).join(', ') || tr('Kapasitet')}: {tx(c.text)}</span>)}
      {unique.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {unique.map(x => (
            <button key={x.text} type="button" className="btn" style={{ minHeight: 32, fontSize: 12 }}
              onClick={() => (x.kind === 'move_quay' ? onQuay(x.quay_id) : onTimes(hmFromIso(x.eta), hmFromIso(x.etd)))}>{tx(x.text)}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- tomt anløp etter flytting

/** Etter flytting/kansellering: anløp som ble tomme kan avlyses med ett trykk. */
function EmptiedPrompt({ calls, onDone }: { calls: OrderChange['emptied']; onDone: () => void }) {
  const cancel = useCancelPortCall();
  const [left, setLeft] = useState(calls);
  if (!left.length) return null;
  const c = left[0];
  const next = () => { const rest = left.slice(1); setLeft(rest); if (!rest.length) onDone(); };
  return (
    <div className="alert-yellow" style={{ borderRadius: 16, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
      <span>{tr('{båt} har ingen salgsordre lenger. Avlyse anløpet?', { båt: c.boat_name })}</span>
      {cancel.isError && <div className="error-box">{errorText(cancel.error)}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn" disabled={cancel.isPending} style={{ minHeight: 34, fontSize: 13 }}
          onClick={() => cancel.mutate({ id: c.id, reason: tr('Ingen salgsordre igjen på båten.') }, { onSuccess: next })}>{tr('Avlys anløpet')}</button>
        <button type="button" className="btn" style={{ minHeight: 34, fontSize: 13 }} onClick={next}>{tr('Behold')}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- detaljpanel for en SO

const callLine = (c: CallRef) => `${c.boat_name} · ${dayShort(c.service_date)} ${timeRange(c)}`;

/** En SO: kunde, båt (bytt/flytt/del), varer, kansellering og endringslogg. */
export function OrderPanel({ id, onClose, onOpenCall }: { id: string; onClose: () => void; onOpenCall?: (callId: string) => void }) {
  const q = useOrder(id);
  const o = q.data;
  const [mode, setMode] = useState<'view' | 'edit' | 'move' | 'cancel'>('view');
  const [emptied, setEmptied] = useState<OrderChange['emptied']>([]);
  const done = (r: OrderChange) => { setMode('view'); setEmptied(r.emptied); };
  useEffect(() => { setMode('view'); setEmptied([]); }, [id]);

  return (
    <aside className="glass scroll drawer" aria-labelledby="so-h"
      style={{ flex: '1 1 400px', maxWidth: 460, padding: 20, display: 'flex', flexDirection: 'column', gap: 16, maxHeight: 'calc(100vh - 120px)', position: 'sticky', top: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <span className="eyebrow">{tr('Salgsordre fra Dynamics 365')}</span>
          <h2 id="so-h" style={{ margin: 0, fontSize: 30, fontWeight: 300 }}>{o ? <SoNo n={o.so_number} style={{ fontWeight: 300 }} /> : '…'}</h2>
          {o && <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><OrderStatusBadge status={o.status} /><span style={{ fontSize: 15 }}>{o.customer}</span></span>}
        </div>
        <button type="button" className="icon-btn pill" onClick={onClose} aria-label={tr('Lukk')} style={{ width: 38, height: 38, flex: 'none' }}><Close size={15} /></button>
      </div>
      {q.isPending && <Loading />}
      {q.isError && <div className="error-box">{errorText(q.error)}</div>}
      {emptied.length > 0 && <EmptiedPrompt calls={emptied} onDone={() => setEmptied([])} />}
      {o && mode === 'edit' && <EditOrder order={o} onDone={done} onCancel={() => setMode('view')} />}
      {o && mode === 'move' && <MoveOrder order={o} onDone={done} onCancel={() => setMode('view')} />}
      {o && mode === 'cancel' && <CancelOrder order={o} onDone={done} onCancel={() => setMode('view')} />}
      {o && mode === 'view' && (
        <>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 14px', fontSize: 14 }}>
            <dt className="sub">{tr('Selger')}</dt><dd style={{ margin: 0 }}>{o.seller?.name ?? '–'}</dd>
            <dt className="sub">{tr('Ønsket dag')}</dt><dd style={{ margin: 0 }}>{o.wanted_date ? dayShort(o.wanted_date) : '–'}</dd>
            {o.notes && <><dt className="sub">{tr('Merknad')}</dt><dd style={{ margin: 0 }}>{o.notes}</dd></>}
          </dl>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h3 className="sub" style={{ margin: 0, fontWeight: 400 }}>{tr('Båt')}</h3>
            {o.calls.map(c => (
              <button key={c.id} type="button" onClick={() => onOpenCall?.(c.id)} className="card" style={{ padding: '10px 12px', gap: 4 }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 16 }}>{c.boat_name}</span><StatusBadge status={c.status} />
                </span>
                <span className="n" style={{ fontSize: 13, color: 'var(--fg-62)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {dayShort(c.service_date)} {timeRange(c)} · <QuayMark quay={c.quay} compact /> · {tr('Lasterekkefølge nr. {n}', { n: c.load_seq })}
                </span>
              </button>
            ))}
            {!o.calls.length && <span className="alert-yellow" style={{ borderRadius: 14, padding: '10px 12px', fontSize: 14 }}>{tr('Venter på båt.')}</span>}
            {o.status !== 'ferdig' && o.status !== 'kansellert' && (
              <button type="button" className="btn btn-w" onClick={() => setMode('move')} style={{ alignSelf: 'flex-start', minHeight: 40, fontSize: 13 }}>
                {o.calls.length ? tr('Bytt båt / flytt') : tr('Legg på båt')}
              </button>
            )}
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h3 className="sub" style={{ margin: 0, fontWeight: 400 }}>{tr('Varer')} · {fr(o.tonnes)} t</h3>
              {o.status !== 'kansellert' && <button type="button" className="tab" onClick={() => setMode('edit')} style={{ minHeight: 30, fontSize: 13 }}>{tr('Rediger')}</button>}
            </div>
            {o.lines.map(l => {
              const c = o.calls.find(x => x.id === l.port_call_id);
              return (
                <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderTop: '1px solid var(--line-soft)', fontSize: 14 }}>
                  <span>{tx(l.label)} <span className="muted" style={{ fontSize: 12 }}>· {l.direction === 'inn' ? tr('Levering') : tr('Henting')}</span></span>
                  {o.calls.length > 1 || !l.port_call_id ? <span className="muted" style={{ fontSize: 12, textAlign: 'right' }}>{c ? callLine(c) : tr('venter på båt')}</span> : null}
                </div>
              );
            })}
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h3 className="sub" style={{ margin: 0, fontWeight: 400 }}>{tr('Endringslogg')}</h3>
            <OrderLog entries={o.log} />
          </section>

          {o.status !== 'ferdig' && o.status !== 'kansellert' && (
            <button type="button" className="btn" onClick={() => setMode('cancel')} style={{ alignSelf: 'flex-start', minHeight: 36, fontSize: 13, color: 'var(--bad-fg)' }}>{tr('Kanseller SO')}</button>
          )}
        </>
      )}
    </aside>
  );
}

function EditOrder({ order: o, onDone, onCancel }: { order: OrderDetail; onDone: (r: OrderChange) => void; onCancel: () => void }) {
  const users = useUsers();
  const skus = useSkus();
  const patch = usePatchOrder();
  const lockedCalls = new Set(o.calls.filter(c => c.status === 'ferdig').map(c => c.id));
  const [customer, setCustomer] = useState(o.customer);
  const [seller, setSeller] = useState(o.seller?.id ?? '');
  const [wanted, setWanted] = useState(o.wanted_date ?? '');
  const [notes, setNotes] = useState(o.notes ?? '');
  const [lines, setLines] = useState<LineDraft[]>(o.lines.map(l => ({ id: l.id, sku_id: l.sku_id, quantity: String(l.quantity), direction: l.direction, locked: !!l.port_call_id && lockedCalls.has(l.port_call_id) })));
  const sellers = (users.data ?? []).filter(u => u.roles.includes('salg') || u.id === o.seller?.id);
  const valid = customer.trim() && lines.some(l => Number(l.quantity) > 0);
  const save = () => valid && patch.mutate({
    id: o.id, version: o.version, customer: customer.trim(), seller_id: seller || null, wanted_date: wanted || null, notes: notes.trim() || null,
    lines: toInput(lines, skus),
  }, { onSuccess: onDone });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label className="field"><span>{tr('Kunde')}</span><input className="inp" value={customer} onChange={e => setCustomer(e.target.value)} /></label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label className="field"><span>{tr('Selger')}</span>
          <select className="inp" value={seller} onChange={e => setSeller(e.target.value)}>
            <option value="">–</option>{sellers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="field"><span>{tr('Ønsket dag')}</span><input className="inp n" type="date" value={wanted} onChange={e => setWanted(e.target.value)} /></label>
      </div>
      <div className="field"><span>{tr('Varer')}</span><LinesEditor lines={lines} onChange={setLines} defaultDirection={lines[0]?.direction ?? 'ut'} /></div>
      <label className="field"><span>{tr('Merknad')}</span><textarea className="inp" rows={2} value={notes} onChange={e => setNotes(e.target.value)} style={{ padding: 10 }} /></label>
      {patch.isError && <div className="error-box">{errorText(patch.error)}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-w" disabled={!valid || patch.isPending} onClick={save}>{patch.isPending ? tr('Lagrer …') : tr('Lagre')}</button>
        <button type="button" className="btn" onClick={onCancel}>{tr('Avbryt')}</button>
      </div>
    </div>
  );
}

/** Bytt båt: hele SO-en, eller bare noen varer (delt levering). */
function MoveOrder({ order: o, onDone, onCancel }: { order: OrderDetail; onDone: (r: OrderChange) => void; onCancel: () => void }) {
  const assign = useAssignOrder();
  const boats = useBoats();
  const quays = useQuays();
  const done = new Set(o.calls.filter(c => c.status === 'ferdig').map(c => c.id));
  const movable = o.lines.filter(l => !l.port_call_id || !done.has(l.port_call_id));
  const [place, setPlace] = useState<PlaceDraft>(o.calls.length ? { kind: 'call', port_call_id: '' } : newPlace(o.wanted_date ?? todayOslo()));
  const [part, setPart] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(movable.map(l => [l.id, String(l.quantity)])));
  const boatFallback = [...(boats.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'nb'))[0]?.id ?? '';
  const quayFallback = (quays.data ?? []).find(q => !q.company)?.id ?? '';
  const placement = place.kind === 'call' && !place.port_call_id ? null : toPlacement(place, boatFallback, quayFallback);
  const picks = movable.map(l => ({ line_id: l.id, quantity: Math.min(l.quantity, Number(qty[l.id]) || 0) })).filter(p => p.quantity > 0);
  const valid = !!placement && (!part || picks.length > 0);
  const save = () => valid && assign.mutate({ id: o.id, version: o.version, placement: placement!, ...(part ? { lines: picks } : {}) }, { onSuccess: onDone });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontSize: 14, color: 'var(--fg-75)' }}>
        {o.calls.length ? tr('Flytt SO-en til en annen båt – for eksempel når kunden sender en annen båt i siste liten.') : tr('Velg båten som skal ta ordren.')}
      </span>
      <PlacePicker value={place.kind === 'call' && !place.port_call_id ? { kind: 'call', port_call_id: '' } : place} onChange={setPlace}
        exclude={o.calls.map(c => c.id)} allowNone={o.calls.length > 0} date={o.wanted_date ?? todayOslo()} />
      {place.kind === 'call' && !place.port_call_id && <span className="sub">{tr('Velg et anløp i lista.')}</span>}
      {movable.length > 0 && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={part} onChange={e => setPart(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#F2F5F3' }} />
          {tr('Bare noen av varene (delt levering)')}
        </label>
      )}
      {part && movable.map(l => (
        <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 8, alignItems: 'center', fontSize: 14 }}>
          <span>{tx(l.label)}</span>
          <input className="inp n" inputMode="numeric" aria-label={tr('Antall som flyttes')} value={qty[l.id] ?? ''} onChange={e => setQty({ ...qty, [l.id]: e.target.value.replace(/\D/g, '') })} />
        </div>
      ))}
      {assign.isError && <div className="error-box">{errorText(assign.error)}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-w" disabled={!valid || assign.isPending} onClick={save}>{assign.isPending ? tr('Lagrer …') : tr('Flytt')}</button>
        <button type="button" className="btn" onClick={onCancel}>{tr('Avbryt')}</button>
      </div>
    </div>
  );
}

function CancelOrder({ order: o, onDone, onCancel }: { order: OrderDetail; onDone: (r: OrderChange) => void; onCancel: () => void }) {
  const cancel = useCancelOrder();
  const [reason, setReason] = useState('');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontSize: 14 }}>{tr('SO-en kanselleres og tas av båten. Varer som er levert blir stående.')}</span>
      <label className="field"><span>{tr('Begrunnelse (påkrevd)')}</span>
        <input className="inp" value={reason} onChange={e => setReason(e.target.value)} placeholder={tr('F.eks. «Kansellert i Dynamics»')} />
      </label>
      {cancel.isError && <div className="error-box">{errorText(cancel.error)}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn" disabled={reason.trim().length < 3 || cancel.isPending} style={{ color: 'var(--bad-fg)' }}
          onClick={() => cancel.mutate({ id: o.id, version: o.version, reason: reason.trim() }, { onSuccess: onDone })}>{tr('Kanseller SO')}</button>
        <button type="button" className="btn" onClick={onCancel}>{tr('Avbryt')}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ny SO

/** Ny salgsordre fra Dynamics 365: SO-nummer, kunde, varer og båt (ingen ennå, planlagt båt eller ny båt). */
export function NewOrderDrawer({ onClose, onCreated, initialCall, initialSo, initialCustomer }: {
  onClose: () => void; onCreated: (o: OrderDetail) => void; initialCall?: string; initialSo?: string; initialCustomer?: string;
}) {
  const me = useMe();
  const users = useUsers();
  const boats = useBoats();
  const quays = useQuays();
  const skus = useSkus();
  const create = useCreateOrder();
  const today = todayOslo();
  const [so, setSo] = useState(initialSo ?? '');
  const [customer, setCustomer] = useState(initialCustomer ?? '');
  const [sellerId, setSellerId] = useState('');
  const [wanted, setWanted] = useState(today);
  const [type, setType] = useState<'ut' | 'inn'>('ut');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([{ sku_id: '', quantity: '', direction: 'ut' }]);
  const [place, setPlace] = useState<PlaceDraft>(initialCall ? { kind: 'call', port_call_id: initialCall } : { kind: 'none' });
  const sellers = (users.data ?? []).filter(u => u.roles.includes('salg'));
  const seller = sellerId || (me.data?.roles.includes('salg') ? me.data.id : '');
  const soOk = /^20\d{5}$/.test(so.trim());
  const boatFallback = [...(boats.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'nb'))[0]?.id ?? '';
  const quayFallback = (quays.data ?? []).find(q => !q.company)?.id ?? '';
  const placement = place.kind === 'call' && !place.port_call_id ? null : toPlacement(place, boatFallback, quayFallback);
  const input = toInput(lines, skus);
  const valid = soOk && customer.trim() && input.length > 0 && !!placement;
  const setType2 = (t: 'ut' | 'inn') => { setType(t); setLines(lines.map(l => ({ ...l, direction: t }))); };
  const save = () => valid && create.mutate({
    so_number: so.trim(), customer: customer.trim(), seller_id: seller || null, wanted_date: wanted || null, notes: notes.trim() || null,
    lines: input, placement: placement!,
  }, { onSuccess: onCreated });

  return (
    <aside className="glass scroll drawer" aria-labelledby="new-so-h"
      style={{ flex: '1 1 400px', maxWidth: 460, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 'calc(100vh - 120px)', position: 'sticky', top: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 id="new-so-h" style={{ margin: 0, fontSize: 24, fontWeight: 300 }}>{tr('Ny salgsordre')}</h2>
        <button type="button" className="icon-btn pill" onClick={onClose} aria-label={tr('Lukk skjema')} style={{ width: 40, height: 40 }}><Close size={16} /></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8 }}>
        <label className="field"><span>{tr('SO-nummer')}</span>
          <input className="inp n" value={so} onChange={e => setSo(e.target.value.replace(/\D/g, '').slice(0, 7))} inputMode="numeric" placeholder="20XXXXX" autoFocus
            aria-invalid={!!so && !soOk} style={so && !soOk ? { borderColor: 'var(--bad-fg)' } : undefined} />
        </label>
        <label className="field"><span>{tr('Kunde')}</span><input className="inp" value={customer} onChange={e => setCustomer(e.target.value)} /></label>
      </div>
      {so && !soOk && <span className="sub" style={{ marginTop: -8, color: 'var(--bad-fg)' }}>{tr('SO-nummeret må være 20 og fem siffer, f.eks. 2043644.')}</span>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label className="field"><span>{tr('Selger')}</span>
          <select className="inp" value={seller} onChange={e => setSellerId(e.target.value)}>
            <option value="">–</option>{sellers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="field"><span>{tr('Ønsket dag')}</span><input className="inp n" type="date" value={wanted} onChange={e => setWanted(e.target.value)} /></label>
      </div>
      <div className="field"><span>{tr('Type')}</span>
        <Segmented label={tr('Type')} value={type} onChange={setType2} stretch options={[{ value: 'ut', label: tr('Henting') }, { value: 'inn', label: tr('Levering') }]} />
      </div>
      <div className="field"><span>{tr('Varer')}</span><LinesEditor lines={lines} onChange={setLines} defaultDirection={type} /></div>
      <div className="field"><span>{tr('Båt')}</span>
        <PlacePicker value={place} onChange={p => setPlace(p.kind === 'new' ? { ...p, date: p.date || wanted } : p)} date={wanted || today} />
      </div>
      <label className="field"><span>{tr('Merknad')}</span><textarea className="inp" rows={2} value={notes} onChange={e => setNotes(e.target.value)} style={{ padding: 10 }} /></label>
      {create.isError && <div className="error-box" role="alert">{errorText(create.error)}</div>}
      <button type="button" className="btn btn-w" onClick={save} disabled={!valid || create.isPending} style={{ minHeight: 50 }}>
        {create.isPending ? tr('Legger inn …') : tr('Legg inn SO')}
      </button>
    </aside>
  );
}

/** SO-ene på et anløp i lasterekkefølge, med piler for å endre rekkefølgen. */
export function CallOrders({ call, onReorder, busy, onOpen, children }: {
  call: PortCallView; onReorder?: (ids: string[]) => void; busy?: boolean; onOpen?: (so: string) => void; children?: ReactNode;
}) {
  const ids = call.orders.map(o => o.id);
  const move = (i: number, d: -1 | 1) => { const n = [...ids]; [n[i], n[i + d]] = [n[i + d], n[i]]; onReorder?.(n); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {call.orders.map((o, i) => (
        <div key={o.id} style={{ display: 'grid', gridTemplateColumns: '26px 1fr auto', gap: 10, alignItems: 'start', padding: '8px 6px', borderBottom: '1px solid var(--line-soft)' }}>
          <span className="n" aria-label={tr('Lasterekkefølge nr. {n}', { n: o.load_seq })}
            style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(128,239,222,.16)', color: 'var(--aqua)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>{o.load_seq}</span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => onOpen?.(o.so_number)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--aqua)', cursor: 'pointer', font: 'inherit' }}>
                <SoNo n={o.so_number} />
              </button>
              <span style={{ fontSize: 14 }}>{o.customer}</span>
              {o.split && <span className="muted" style={{ fontSize: 12 }}>· {tr('delt levering')}</span>}
            </span>
            {o.goods.map(g => <span key={g.id} style={{ fontSize: 13, color: 'var(--fg-75)' }}>{tx(g.label)} <span className="muted">· {g.direction === 'inn' ? tr('Levering') : tr('Henting')}</span></span>)}
          </span>
          {onReorder && call.orders.length > 1 && (
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <button type="button" className="icon-btn pill" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={tr('Flytt {so} opp', { so: `SO ${o.so_number}` })} style={{ width: 28, height: 28 }}>▲</button>
              <button type="button" className="icon-btn pill" disabled={busy || i === call.orders.length - 1} onClick={() => move(i, 1)} aria-label={tr('Flytt {so} ned', { so: `SO ${o.so_number}` })} style={{ width: 28, height: 28 }}>▼</button>
            </span>
          )}
        </div>
      ))}
      {!call.orders.length && <span className="muted" style={{ padding: 6, fontSize: 14 }}>{tr('Ingen salgsordre på båten ennå.')}</span>}
      {children}
    </div>
  );
}
