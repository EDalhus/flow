import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorText } from '../lib/api.ts';
import { osloTime } from '../lib/format.ts';
import { Close } from './Icons.tsx';

type Diagnose = {
  result: { ok: boolean; configured: boolean; message: string | null; positions: number; boats: number; checked_at: string };
  secrets: { BW_CLIENT_ID: boolean; BW_CLIENT_SECRET: boolean };
  boats_with_mmsi: number;
};

/** Admin: kjør AIS-sjekk nå og vis hva som mangler. Viser aldri nøkkelverdier, bare om de finnes. */
export function AisCheck({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [state, setState] = useState<{ loading: boolean; data?: Diagnose; error?: string }>({ loading: false });

  const run = async () => {
    setState({ loading: true });
    try {
      const data = await api<Diagnose>('/ais/sync', { method: 'POST', body: {} });
      setState({ loading: false, data });
      qc.invalidateQueries({ queryKey: ['ais'] });
      qc.invalidateQueries({ queryKey: ['port-calls'] });
    } catch (e) {
      setState({ loading: false, error: errorText(e) });
    }
  };

  const d = state.data;
  const row = (label: string, ok: boolean, text: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.06)', fontSize: 14 }}>
      <span>{label}</span>
      <span style={{ color: ok ? '#7FE0A3' : '#FF8A80', textAlign: 'right' }}>{text}</span>
    </div>
  );

  return (
    <div className="glass" role="dialog" aria-label="AIS-sjekk" style={{ width: 380, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, background: 'rgba(17,21,25,.92)', pointerEvents: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 17 }}>AIS-tilkobling</span>
        <button type="button" className="icon-btn pill" onClick={onClose} aria-label="Lukk" style={{ width: 36, height: 36 }}><Close size={14} /></button>
      </div>
      {!d && !state.error && <p style={{ margin: 0, fontSize: 14, color: 'var(--fg-75)' }}>Henter posisjoner fra BarentsWatch nå og viser hva som eventuelt mangler.</p>}
      {d && (
        <div>
          {row('BW_CLIENT_ID', d.secrets.BW_CLIENT_ID, d.secrets.BW_CLIENT_ID ? 'funnet' : 'mangler')}
          {row('BW_CLIENT_SECRET', d.secrets.BW_CLIENT_SECRET, d.secrets.BW_CLIENT_SECRET ? 'funnet' : 'mangler')}
          {row('Båter med MMSI', d.boats_with_mmsi > 0, String(d.boats_with_mmsi))}
          {row('BarentsWatch', d.result.ok && d.result.configured,
            d.result.ok && d.result.configured ? `OK · ${d.result.positions} posisjoner` : d.result.configured ? 'feil' : 'ikke forsøkt')}
          {d.result.message && <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--fg-75)' }}>{d.result.message}</p>}
          <p className="n" style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--fg-55)' }}>Sjekket {osloTime(d.result.checked_at)}</p>
        </div>
      )}
      {state.error && <div className="error-box" role="alert">{state.error}</div>}
      <button type="button" className="btn btn-w" onClick={run} disabled={state.loading} style={{ minHeight: 44 }}>
        {state.loading ? 'Sjekker …' : d ? 'Sjekk igjen' : 'Sjekk AIS nå'}
      </button>
    </div>
  );
}
