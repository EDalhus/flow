import type { ReactNode } from 'react';
import type { AisVessel, PortCallView } from '../../../shared/api.ts';
import { Vessel } from '../components/Icons.tsx';
import { STATUS_STYLE, osloTime } from '../lib/format.ts';
import type { Project } from './FlowMap.tsx';

// Båter på kartet. Båter med anløp hos oss (i dag/i morgen) fremheves med navn og status;
// andre båter fra kaiboka vises grått. Uten AIS-posisjon tegnes båter som er ved kai ved kaia.

export interface VesselLayerProps {
  project: Project;
  vessels: AisVessel[];
  calls: PortCallView[];
  selectedId?: string;
  onSelect: (callId: string) => void;
  quayPos: (quayId: string) => { lat: number; lon: number };
  today: string;
  compact?: boolean;
  /** Kort ved valgt båt (desktop). */
  card?: (x: number, y: number) => ReactNode;
}

interface Placed { key: string; x: number; y: number; rot: number; name: string; call: PortCallView | null; inGeofence: boolean; track: [number, number][] }

export function VesselLayer({ project, vessels, calls, selectedId, onSelect, quayPos, today, compact, card }: VesselLayerProps) {
  const active = calls.filter(c => c.status !== 'ferdig' && c.status !== 'avlyst');
  // Neste aktive anløp per båt.
  const callFor = (boatId: string) => active.filter(c => c.boat.id === boatId).sort((a, b) => a.eta.localeCompare(b.eta))[0] ?? null;

  const placed: Placed[] = [];
  for (const v of vessels) {
    const p = project(v.lon, v.lat);
    if (!p) continue;
    placed.push({ key: v.mmsi, x: p[0], y: p[1], rot: v.heading ?? v.cog ?? 0, name: v.name, call: callFor(v.boat_id), inGeofence: v.in_geofence, track: v.track });
  }
  // Ved kai uten AIS: tegn ved kaia.
  const withAis = new Set(vessels.map(v => v.boat_id));
  active.filter(c => c.status === 'ved_kai' && !withAis.has(c.boat.id)).forEach((c, i) => {
    const q = quayPos(c.quay.id);
    const p = project(q.lon, q.lat);
    if (p) placed.push({ key: c.id, x: p[0] + i * 4, y: p[1] + 26 + i * 44, rot: 80, name: c.boat.name, call: c, inGeofence: true, track: [] });
  });

  const hot = placed.filter(v => v.call);
  const gray = placed.filter(v => !v.call);
  const sel = hot.find(v => v.call!.id === selectedId);
  const size = compact ? 34 : 36;

  const tag = (v: Placed) => {
    if (v.inGeofence) return 'ved kai';
    const c = v.call!;
    return c.service_date === today ? (c.time_known ? osloTime(c.eta) : 'i dag') : 'i morgen';
  };

  return (
    <>
      <svg aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
        {hot.filter(v => v.track.length > 1).map(v => {
          const pts = v.track.map(([lon, lat]) => project(lon, lat)).filter(Boolean) as [number, number][];
          const on = v === sel;
          return (
            <polyline key={v.key} points={pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} fill="none"
              stroke={on ? '#80EFDE' : 'rgba(var(--tint), .3)'} strokeWidth={on ? 2.2 : 1.4} strokeDasharray={compact ? '4 5' : '5 6'} strokeLinecap="round" strokeLinejoin="round" />
          );
        })}
      </svg>

      {gray.map(v => (
        <span key={v.key} title={`${v.name} – i kaiboka, ikke booket`}
          style={{ position: 'absolute', left: v.x, top: v.y, width: 22, height: 22, transform: 'translate(-11px, -11px)', borderRadius: '50%', background: 'rgba(var(--tint), .14)', border: '1px solid rgba(var(--tint), .18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Vessel size={11} fill="rgba(var(--tint), .7)" rotate={v.rot} />
        </span>
      ))}

      {sel && (
        <span className="ring" aria-hidden="true" style={{ position: 'absolute', left: sel.x, top: sel.y, width: compact ? 110 : 132, height: compact ? 110 : 132, borderRadius: '50%', border: '1.5px dashed rgba(128,239,222,.6)', pointerEvents: 'none', background: 'radial-gradient(circle, rgba(128,239,222,.1), rgba(128,239,222,0) 70%)' }} />
      )}

      {hot.map(v => {
        const c = v.call!;
        const on = v === sel;
        const s = STATUS_STYLE[c.status];
        return (
          <button key={v.key} type="button" onClick={() => onSelect(c.id)}
            aria-label={`${c.boat.name}, ${v.inGeofence ? 'ved vår kai' : (c.time_known ? `ETA ${osloTime(c.eta)}` : 'tid ikke satt')}, ${s.label}`}
            style={{ position: 'absolute', left: v.x, top: v.y, zIndex: on ? 4 : 3, padding: 0, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, transform: `translate(-${size / 2}px, -${size / 2}px)`, minWidth: 44, minHeight: 44 }}>
            <span style={{ position: 'relative', width: size, height: size, flex: 'none', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(8px)',
              ...(on ? { background: '#80EFDE', boxShadow: '0 0 0 8px rgba(128,239,222,.2)', width: size + 14, height: size + 14 } : { background: 'rgba(51,64,56,.85)', border: '1px solid rgba(var(--tint), .25)' }) }}>
              <Vessel size={compact ? 15 : 16} fill={on ? '#1A231E' : '#F2F5F3'} rotate={v.rot} />
              <span style={{ position: 'absolute', top: -1, right: -1, width: 11, height: 11, borderRadius: '50%', border: '2px solid #1A231E', background: c.collisions.length ? '#E5484D' : s.c }} />
            </span>
            {!compact && <span className="vessel-label">{c.boat.name} <span className="n" style={{ color: 'var(--fg-62)' }}>{tag(v)}</span></span>}
          </button>
        );
      })}

      {card && sel && card(sel.x, sel.y)}
    </>
  );
}

/** Er AIS-dataene ferske (siste synk ok og under 5 minutter gammel)? */
export function aisLive(status: { ok: boolean; checked_at: string } | null | undefined, now: Date) {
  return !!status?.ok && now.getTime() - Date.parse(status.checked_at) < 5 * 60_000;
}
