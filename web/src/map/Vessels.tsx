import type { AisVessel, PortCallView } from '../../../shared/api.ts';
import type { Project } from './FlowMap.tsx';
import { tr } from '../lib/i18n.ts';

// Båter med anløp hos oss som ligger ved kai uten AIS-posisjon: tegnes ved kaia med navnet.
// Alle båter med AIS-posisjon tegnes som kartlag (se traffic.ts).

export interface VesselLayerProps {
  project: Project;
  vessels: AisVessel[];
  calls: PortCallView[];
  selectedId?: string;
  onSelect: (callId: string) => void;
  quayPos: (quayId: string) => { lat: number; lon: number };
}

export function VesselLayer({ project, vessels, calls, selectedId, onSelect, quayPos }: VesselLayerProps) {
  const withAis = new Set(vessels.map(v => v.boat_id));
  const atQuay = calls.filter(c => c.status === 'ved_kai' && !withAis.has(c.boat.id));
  return (
    <>
      {atQuay.map((c, i) => {
        const q = quayPos(c.quay.id);
        const p = project(q.lon, q.lat);
        if (!p) return null;
        const on = c.id === selectedId;
        return (
          <button key={c.id} type="button" onClick={() => onSelect(c.id)} aria-label={tr('{båt}, ved kai (uten AIS)', { båt: c.boat.name })}
            style={{ position: 'absolute', left: p[0] + 10, top: p[1] + 18 + i * 26, display: 'flex', alignItems: 'center', gap: 6, padding: 0, border: 'none', background: 'none', cursor: 'pointer', minHeight: 24 }}>
            <span aria-hidden="true" style={{ width: 10, height: 18, background: '#80EFDE', clipPath: 'polygon(50% 0, 100% 30%, 100% 100%, 0 100%, 0 30%)', transform: 'rotate(80deg)', outline: on ? '2px solid #fff' : undefined }} />
            <span className="ship-name">{c.boat.name}</span>
          </button>
        );
      })}
    </>
  );
}
