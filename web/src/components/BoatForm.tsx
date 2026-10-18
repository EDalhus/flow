import { useState } from 'react';
import type { BoatView } from '../../../shared/api.ts';
import { errorText } from '../lib/api.ts';
import { useAgents, useSaveBoat } from '../lib/queries.ts';
import { Close } from './Icons.tsx';
import { tr } from '../lib/i18n.ts';

/** Ny båt eller redigering. MMSI trengs for at AIS skal finne båten. */
export function BoatForm({ boat, onClose, onSaved }: { boat?: BoatView; onClose: () => void; onSaved: (id: string) => void }) {
  const agents = useAgents();
  const save = useSaveBoat();
  const [f, setF] = useState({
    name: boat?.name ?? '', mmsi: boat?.mmsi ?? '', imo: boat?.imo ?? '', callsign: boat?.callsign ?? '',
    agent_id: boat?.agent?.id ?? '', ship_contact: boat?.ship_contact ?? '', ship_phone: boat?.ship_phone ?? '', note: boat?.note ?? '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const mmsiOk = !f.mmsi || /^\d{9}$/.test(f.mmsi.trim());
  const imoOk = !f.imo || /^\d{7}$/.test(f.imo.trim());

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      name: f.name.trim(), mmsi: f.mmsi.trim() || null, imo: f.imo.trim() || null, callsign: f.callsign.trim() || null,
      agent_id: f.agent_id || null, ship_contact: f.ship_contact.trim() || null, ship_phone: f.ship_phone.trim() || null, note: f.note.trim() || null,
    };
    save.mutate({ id: boat?.id, body }, { onSuccess: b => onSaved(b.id) });
  };

  return (
    <form onSubmit={submit} aria-labelledby="boat-form-h" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 id="boat-form-h" style={{ margin: 0, fontSize: 24, fontWeight: 300 }}>{boat ? tr('Rediger {navn}', { navn: boat.name }) : tr('Ny båt')}</h2>
        <button type="button" className="icon-btn pill" onClick={onClose} aria-label={tr('Lukk')} style={{ width: 40, height: 40 }}><Close size={16} /></button>
      </div>
      <label className="field"><span>{tr('Navn')}</span><input className="inp" value={f.name} onChange={set('name')} required maxLength={100} /></label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field"><span>{tr('MMSI (9 siffer)')}</span>
          <input className="inp n" value={f.mmsi} onChange={set('mmsi')} inputMode="numeric" aria-invalid={!mmsiOk} style={mmsiOk ? undefined : { borderColor: '#FF6B5E' }} />
        </label>
        <label className="field"><span>{tr('IMO (7 siffer)')}</span>
          <input className="inp n" value={f.imo} onChange={set('imo')} inputMode="numeric" aria-invalid={!imoOk} style={imoOk ? undefined : { borderColor: '#FF6B5E' }} />
        </label>
      </div>
      <span style={{ fontSize: 12, color: 'var(--fg-55)', marginTop: -4 }}>{tr('MMSI brukes til å hente posisjon fra AIS (BarentsWatch).')}</span>
      <label className="field"><span>{tr('Kallesignal')}</span><input className="inp" value={f.callsign} onChange={set('callsign')} maxLength={20} /></label>
      <label className="field"><span>{tr('Agent')}</span>
        <select className="inp" value={f.agent_id} onChange={set('agent_id')}>
          <option value="">{tr('Ingen agent')}</option>
          {(agents.data ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field"><span>{tr('Kontakt om bord')}</span><input className="inp" value={f.ship_contact} onChange={set('ship_contact')} placeholder={tr('Skipper, Bro …')} /></label>
        <label className="field"><span>{tr('Båtens telefon')}</span><input className="inp n" value={f.ship_phone} onChange={set('ship_phone')} inputMode="tel" placeholder="+47 …" /></label>
      </div>
      <label className="field"><span>{tr('Merknad')}</span>
        <textarea className="inp" value={f.note} onChange={set('note')} rows={3} style={{ padding: '10px 12px', resize: 'vertical' }} />
      </label>
      {save.isError && <div className="error-box" role="alert">{errorText(save.error)}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn btn-w" disabled={!f.name.trim() || !mmsiOk || !imoOk || save.isPending} style={{ minHeight: 46 }}>
          {save.isPending ? tr('Lagrer …') : tr('Lagre')}
        </button>
        <button type="button" className="btn" onClick={onClose} style={{ minHeight: 46 }}>{tr('Avbryt')}</button>
      </div>
    </form>
  );
}
