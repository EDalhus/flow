import { useState, type CSSProperties } from 'react';
import type { BulkOrderView, BulkQuality, Vehicle } from '../../../shared/api.ts';
import { bulkPhase } from '../../../shared/domain/bulk.ts';
import type { BulkOrderCreateInput } from '../../../shared/schemas.ts';
import { osloToUtc } from '../../../shared/time.ts';
import { addDays, dayShort, fr, osloTime, todayOslo } from '../lib/format.ts';
import { tr } from '../lib/i18n.ts';
import { Close, Plus } from './Icons.tsx';
import { Segmented } from './ui.tsx';

// Bulkutlevering: felles biter for kontoret (Bulkbil) og sjåførvisningen (/sjafor).

/** Fase og tekst for en bestilling. */
export function phaseInfo(o: BulkOrderView): { text: string; color: string; bg: string } {
  const p = bulkPhase(o.status, o.steps, o.stopped_at);
  const step = (seq: number) => o.steps.find(s => s.seq === seq);
  const where = (seq: number) => (step(seq)?.target === 'henger' ? tr('henger') : tr('bil'));
  switch (p.kind) {
    case 'venter': return o.expected_at && o.expected_at > new Date().toISOString()
      ? { text: tr('Bestilt · ca. {tid}', { tid: `${dayShort(o.expected_at.slice(0, 10))} ${osloTime(o.expected_at)}` }), color: 'var(--fg-62)', bg: 'rgba(var(--tint), .06)' }
      : { text: tr('Venter · bestilt {tid}', { tid: osloTime(o.created_at) }), color: 'var(--fg-62)', bg: 'rgba(var(--tint), .06)' };
    case 'laster': return { text: tr('Laster {hva}', { hva: where(p.step) }), color: 'var(--aqua)', bg: 'rgba(128,239,222,.14)' };
    case 'pause': return { text: tr('Pause – flytt til {hva}', { hva: where(p.next) }), color: 'var(--warn-fg)', bg: 'rgba(247,185,85,.16)' };
    case 'stoppet': return { text: tr('NØDSTOPP'), color: '#fff', bg: '#E5484D' };
    default: return o.status === 'avlyst'
      ? { text: tr('Fjernet'), color: 'var(--fg-55)', bg: 'rgba(var(--tint), .06)' }
      : { text: tr('Ferdig {tid}', { tid: o.finished_at ? osloTime(o.finished_at) : '' }), color: 'var(--ok-fg)', bg: 'rgba(91,214,138,.14)' };
  }
}

export function PhaseBadge({ o, style }: { o: BulkOrderView; style?: CSSProperties }) {
  const p = phaseInfo(o);
  return <span className="badge" style={{ background: p.bg, color: p.color, fontWeight: 500, ...style }}>{p.text}</span>;
}

/** Stegene: kvalitet, bestilt og veid tonn, bil/henger. */
export function StepChips({ o, large }: { o: BulkOrderView; large?: boolean }) {
  const p = bulkPhase(o.status, o.steps, o.stopped_at);
  const current = p.kind === 'laster' ? p.step : p.kind === 'pause' ? p.next : p.kind === 'stoppet' ? p.step : null;
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {o.steps.map(s => (
        <span key={s.id} style={{ ['--q' as string]: s.color, display: 'flex', alignItems: 'center', gap: 8, borderRadius: 16, padding: large ? '12px 16px' : '7px 12px',
          fontSize: large ? 18 : 14, border: `2px solid ${s.seq === current ? s.color : 'var(--line)'}`,
          background: s.seq === current ? `color-mix(in srgb, ${s.color} 16%, transparent)` : 'rgba(var(--tint), .04)', opacity: s.finished_at && o.status !== 'ferdig' ? .6 : 1 }}>
          <span className="qdot" />
          {s.target && <span>{s.target === 'henger' ? tr('Henger') : tr('Bil')}:</span>}
          <span className="n">{fr(s.tonnes)} t</span> {s.quality_name}
          {s.weighed_tonnes != null && <span className="n" style={{ color: 'var(--ok-fg)', fontSize: '.85em' }}>· {tr('veid {n} t', { n: fr(s.weighed_tonnes, 2) })}</span>}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- bestilling

type StepDraft = { quality_id: string; tonnes: string; target: 'bil' | 'henger' };

/**
 * Bestilling: bil, kunde (prosjektnummer når kunden krever det), SO, nå eller ca. tid, og stegene (bil + ev. henger).
 * Kontoret velger også sjåfør; sjåføren bestiller for seg selv.
 */
export function BookingForm({ vehicles, customers, qualities, drivers, pending, error, onSubmit, onCancel, large }: {
  vehicles: Vehicle[]; customers: { id: string; name: string; requires_project: boolean }[]; qualities: BulkQuality[];
  /** Bare på kontoret: sjåfører (filtreres på bilens transportfirma). */
  drivers?: { id: string; name: string; hauler: { id: string } }[];
  pending: boolean; error: string | null; onSubmit: (b: BulkOrderCreateInput) => void; onCancel?: () => void; large?: boolean;
}) {
  const storedVehicle = (() => { try { return localStorage.getItem('flow-bulk-bil') ?? ''; } catch { return ''; } })();
  const [vehicleId, setVehicleId] = useState(vehicles.find(v => v.id === storedVehicle)?.id ?? vehicles[0]?.id ?? '');
  const [driverId, setDriverId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [project, setProject] = useState('');
  const [so, setSo] = useState('');
  const [later, setLater] = useState(false);
  const [day, setDay] = useState(todayOslo());
  const [time, setTime] = useState('12:00');
  const [notes, setNotes] = useState('');
  const [steps, setSteps] = useState<StepDraft[]>([{ quality_id: '', tonnes: '16', target: 'bil' }]);
  const vehicle = vehicles.find(v => v.id === vehicleId);
  const customer = customers.find(c => c.id === customerId);
  const driverOptions = (drivers ?? []).filter(d => !vehicle || d.hauler.id === vehicle.hauler_id);
  const set = (i: number, p: Partial<StepDraft>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const parsed = steps.map(s => ({ quality_id: s.quality_id, tonnes: Number(s.tonnes.replace(',', '.')), target: s.target }));
  const total = parsed.reduce((t, s) => t + (s.tonnes || 0), 0);
  const soOk = !so || /^20\d{5}$/.test(so);
  const valid = vehicle && customer && (!customer.requires_project || project.trim()) && soOk
    && parsed.every(s => s.quality_id && s.tonnes > 0 && s.tonnes <= 60) && (!later || /^\d{2}:\d{2}$/.test(time));
  const fz = large ? 18 : 15;

  const submit = () => {
    if (!valid) return;
    try { localStorage.setItem('flow-bulk-bil', vehicleId); } catch { /* ignorer */ }
    onSubmit({
      vehicle_id: vehicleId, customer_id: customerId, driver_id: drivers ? driverId || null : undefined, project_no: project.trim() || null,
      so_number: so || null, expected_at: later ? osloToUtc(day, time) : null, notes: notes.trim() || null, steps: parsed,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: fz }}>
      <div style={{ display: 'grid', gridTemplateColumns: drivers ? '1fr 1fr' : '1fr', gap: 10 }}>
        <label className="field"><span>{tr('Bil (reg.nr.)')}</span>
          <select className="inp" value={vehicleId} onChange={e => setVehicleId(e.target.value)} style={{ fontSize: fz }}>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.reg_no}{v.description ? ` · ${v.description}` : ''}</option>)}
          </select>
        </label>
        {drivers && (
          <label className="field"><span>{tr('Sjåfør')}</span>
            <select className="inp" value={driverId} onChange={e => setDriverId(e.target.value)}>
              <option value="">–</option>{driverOptions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <label className="field"><span>{tr('Hvem skal ha saltet?')}</span>
        <select className="inp" value={customerId} onChange={e => setCustomerId(e.target.value)} style={{ fontSize: fz }}>
          <option value="">{tr('Velg kunde …')}</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.requires_project ? ` · ${tr('krever prosjektnr.')}` : ''}</option>)}
        </select>
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field"><span>{customer?.requires_project ? tr('Prosjektnummer (påkrevd)') : tr('Prosjektnummer (valgfritt)')}</span>
          <input className="inp" value={project} onChange={e => setProject(e.target.value)} style={{ fontSize: fz, ...(customer?.requires_project && !project.trim() ? { borderColor: 'var(--warn-fg)' } : {}) }} />
        </label>
        <label className="field"><span>{tr('SO-nummer (valgfritt)')}</span>
          <input className="inp n" value={so} inputMode="numeric" placeholder="20XXXXX" onChange={e => setSo(e.target.value.replace(/\D/g, '').slice(0, 7))}
            style={{ fontSize: fz, ...(soOk ? {} : { borderColor: 'var(--bad-fg)' }) }} />
        </label>
      </div>
      <div className="field"><span>{tr('Når?')}</span>
        <Segmented label={tr('Når?')} value={later ? 'senere' : 'na'} onChange={v => setLater(v === 'senere')} stretch
          options={[{ value: 'na', label: tr('Nå – jeg er her') }, { value: 'senere', label: tr('Senere (ca. tid)') }]} />
      </div>
      {later && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 10 }}>
          <select className="inp" aria-label={tr('Dag')} value={day} onChange={e => setDay(e.target.value)} style={{ fontSize: fz }}>
            {Array.from({ length: 14 }, (_, i) => addDays(todayOslo(), i)).map(d => <option key={d} value={d}>{dayShort(d)}</option>)}
          </select>
          <input className="inp n" type="time" aria-label={tr('Ca. tid')} value={time} onChange={e => setTime(e.target.value)} style={{ fontSize: fz }} />
        </div>
      )}
      {steps.map((s, i) => (
        <div key={s.target} className="step-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 32 }}>
            <span className="eyebrow">{s.target === 'bil' ? tr('Bil') : tr('Henger')}</span>
            {s.target === 'henger' && (
              <button type="button" className="icon-btn" aria-label={tr('Fjern henger')} style={{ width: 32, height: 32 }} onClick={() => setSteps(steps.filter((_, j) => j !== i))}><Close size={14} /></button>
            )}
          </div>
          <div role="group" aria-label={tr('Kvalitet')} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {qualities.map(q => (
              <button key={q.id} type="button" className="qbtn" aria-pressed={s.quality_id === q.id} style={{ ['--q' as string]: q.color, fontSize: fz }} onClick={() => set(i, { quality_id: q.id })}>
                <span className="qdot" />{q.name}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="field" style={{ width: 100 }}><span>{tr('Tonn')}</span>
              <input className="inp n" inputMode="decimal" value={s.tonnes} onChange={e => set(i, { tonnes: e.target.value })} style={{ fontSize: fz }} />
            </label>
            {[14, 16, 18, 20].map(n => (
              <button key={n} type="button" className="tab" aria-pressed={s.tonnes === String(n)} onClick={() => set(i, { tonnes: String(n) })} style={{ minHeight: 40, border: '1px solid var(--line)' }}>{n}</button>
            ))}
          </div>
        </div>
      ))}
      {steps.length === 1 && vehicle?.has_trailer && (
        <button type="button" className="btn" onClick={() => setSteps([...steps, { quality_id: '', tonnes: '12', target: 'henger' }])}
          style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 40 }}>
          <Plus size={14} /> {tr('Legg til henger')}
        </button>
      )}
      <label className="field"><span>{tr('Merknad')}</span><input className="inp" value={notes} onChange={e => setNotes(e.target.value)} style={{ fontSize: fz }} /></label>
      {error && <div className="error-box" role="alert">{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-w" disabled={!valid || pending} onClick={submit} style={{ flex: 1, minHeight: large ? 60 : 46, fontSize: large ? 17 : 14 }}>
          {tr('Bestill {n} t', { n: fr(total) })}
        </button>
        {onCancel && <button type="button" className="btn" onClick={onCancel} style={{ minHeight: large ? 60 : 46 }}>{tr('Avbryt')}</button>}
      </div>
    </div>
  );
}

/** CSV med semikolon (åpnes rett i Excel med norsk oppsett). */
export function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => { const s = v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : v; return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob([`﻿${rows.map(r => r.map(esc).join(';')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
