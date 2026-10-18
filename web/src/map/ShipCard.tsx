import { useQueryClient } from '@tanstack/react-query';
import { useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import type { BoatDetail } from '../../../shared/api.ts';
import { shipTypeLabel } from '../../../shared/domain/shiptype.ts';
import { Close } from '../components/Icons.tsx';
import { api, errorText } from '../lib/api.ts';
import { fr, osloTime, titleCase } from '../lib/format.ts';
import { useMe } from '../lib/queries.ts';
import { canBoats } from '../lib/roles.ts';
import { useT } from '../lib/i18n.ts';
import { CATEGORY_COLOR, LEGEND_TYPES, RANGE_STEPS, ago, degMin, type LegendType, type RangeKm, type TrafficVessel } from './traffic.ts';
import type { Approach } from './useTraffic.ts';

// Kort for et valgt fartøy i trafikkbildet (desktop ved skipet, mobil festet over kartet).

/** «4,1 nm til kaia · ca. 26 min i 9,5 kn». */
export function approachText(a: Approach) {
  const when = a.minutes == null ? 'ligger stille' : a.minutes < 90 ? `ca. ${Math.round(a.minutes)} min` : `ca. ${fr(a.minutes / 60)} t`;
  return `${fr(a.nm)} nm til kaia · ${when}${a.knots != null && a.minutes != null ? ` i ${fr(a.knots)} kn` : ''}`;
}

export const approachLabel = (a: Approach | null) =>
  !a ? 'Til vår kai' : a.sea ? 'Til vår kai (sjøvei)' : a.pending ? 'Til vår kai (beregner sjøvei …)' : 'Til vår kai (luftlinje – fant ikke sjøvei)';

/** Info om et fartøy i trafikkbildet, som når man klikker et skip i Kystverkets kart. */
export function ShipCard({ v, x = 0, y = 0, now, approach: a, trackError, onClose, docked }: {
  v: TrafficVessel; x?: number; y?: number; now: number; approach: Approach | null; trackError: string | null; onClose: () => void;
  /** Fast plassering (mobil) i stedet for ved skipet. */
  docked?: CSSProperties;
}) {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = v.info;
  const name = v.name ? titleCase(v.name) : `MMSI ${v.mmsi}`;
  const type = v.cat === 'flow' ? 'Vår båt' : shipTypeLabel(info?.ship_type) ?? 'Ukjent type';
  const add = async () => {
    setBusy(true); setError(null);
    try {
      const b = await api<BoatDetail>('/boats', { body: { name, mmsi: v.mmsi, imo: info?.imo && /^\d{7}$/.test(info.imo) ? info.imo : null, callsign: info?.callsign ?? null } });
      qc.invalidateQueries({ queryKey: ['boats'] });
      qc.invalidateQueries({ queryKey: ['ais'] });
      navigate(`/baater?id=${b.id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const left = x + 34 + 300 > window.innerWidth - 24 ? x - 34 - 300 : x + 34;
  const top = Math.min(Math.max(y - 60, 110), window.innerHeight - 420);
  const cell = (k: string, val: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flex: 1 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{k}</span>
      <span className="n" style={{ fontSize: 14, color: 'var(--fg-75)' }}>{val}</span>
    </div>
  );
  return (
    <div className={docked ? 'glass' : 'glass ov-hide'} role="dialog" aria-label={`Fartøy ${name}`}
      style={{ position: 'absolute', left, top, width: 300, ...docked, padding: 16, borderRadius: 18, background: 'rgba(30,34,38,.88)', display: 'flex', flexDirection: 'column', gap: 12, zIndex: 6 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(242,245,243,.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <span style={{ width: 12, height: 22, background: CATEGORY_COLOR[v.cat], clipPath: 'polygon(50% 0, 100% 30%, 100% 100%, 0 100%, 0 30%)', transform: 'rotate(30deg)' }} />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 17, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          <span style={{ fontSize: 13, color: 'var(--fg-62)' }}>
            {[info?.country, info?.callsign, type].filter(Boolean).join(' · ')}
          </span>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Lukk" style={{ width: 32, height: 32 }}><Close size={14} /></button>
      </div>
      <div style={{ display: 'flex', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', padding: '10px 0' }}>
        {cell('Stevning', v.heading != null ? `${Math.round(v.heading)}°` : '–')}
        {cell('Kurs', v.cog != null ? `${fr(v.cog)}°` : '–')}
        {cell('Fart', v.sog != null ? `${fr(v.sog)} kn` : '–')}
      </div>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 12px', fontSize: 13 }}>
        {info?.destination && <><dt style={{ fontWeight: 600 }}>Destinasjon</dt><dd style={{ margin: 0, textAlign: 'right' }}>{info.destination}</dd></>}
        {info?.length && <><dt style={{ fontWeight: 600 }}>Størrelse</dt><dd className="n" style={{ margin: 0, textAlign: 'right' }}>{fr(info.length, 0)} × {info.width ? fr(info.width, 0) : '–'} m{info.draught ? ` · ${fr(info.draught)} m dypg.` : ''}</dd></>}
        <dt style={{ fontWeight: 600 }}>Posisjon</dt>
        <dd className="n" style={{ margin: 0, textAlign: 'right' }}>{degMin(v.lat, 'N', 'S')}, {degMin(v.lon, 'Ø', 'V')}</dd>
        <dt style={{ fontWeight: 600 }}>Oppdatert</dt>
        <dd className="n" style={{ margin: 0, textAlign: 'right' }}>{osloTime(v.ts)} · {ago(v.ts, now)}</dd>
      </dl>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 10px', borderRadius: 12, background: 'rgba(128,239,222,.08)' }}>
        <span style={{ fontSize: 12, color: 'var(--fg-62)' }}>{approachLabel(a)}</span>
        {a && <span className="n" style={{ fontSize: 14, color: 'var(--aqua)' }}>{approachText(a)}</span>}
      </div>
      <span style={{ fontSize: 12, color: 'var(--fg-55)' }}>
        Ringene: 6, 12, 24, 36, 48, 60 min og 3 t med farten nå. Turkis linje: sporet siste døgn. Stiplet turkis: sjøveien til kaia{trackError ? ` (ikke tilgjengelig: ${trackError})` : ''}.
      </span>
      {error && <div className="error-box">{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        {v.boatId
          ? <button type="button" className="btn" style={{ minHeight: 36, fontSize: 13 }} onClick={() => navigate(`/baater?id=${v.boatId}`)}>Åpne i båtregisteret</button>
          : canBoats(me.data) && <button type="button" className="btn btn-w" style={{ minHeight: 36, fontSize: 13 }} disabled={busy} onClick={add}>Legg til i båtregisteret</button>}
      </div>
    </div>
  );
}

const hull = (c: string) => <span aria-hidden="true" style={{ width: 8, height: 13, flex: 'none', background: c, clipPath: 'polygon(50% 0, 100% 30%, 100% 100%, 0 100%, 0 30%)' }} />;

/** Det fargeforklaringen trenger fra useTraffic. */
export interface LegendState {
  showOthers: boolean; setShowOthers: (v: boolean) => void;
  colorOthers: boolean; setColorOthers: (v: boolean) => void;
  hidden: ReadonlySet<LegendType>; toggleType: (k: LegendType) => void;
  range: RangeKm; setRange: (v: RangeKm) => void;
  coastPending: boolean; coastError: string | null; coastCount: number | null;
}

/**
 * Fargeforklaring og valg for båtene på kartet: andre båter av/på og farger eller grå, hvor langt ut
 * fra kaia de vises (eller hele kysten), og typer som kan skrus av ved å trykke på dem.
 */
export function TrafficLegend({ s, className = 'ov kart-legend ov-hide' }: { s: LegendState; className?: string }) {
  const t = useT();
  const idx = RANGE_STEPS.indexOf(s.range);
  const types = s.showOthers ? LEGEND_TYPES : (['flow'] as const);
  return (
    <div className={className} role="group" aria-label={t('legend.label')}>
      <div className="legend-row">
        <button type="button" className="tab legend-btn" aria-pressed={s.showOthers} onClick={() => s.setShowOthers(!s.showOthers)}>
          {s.showOthers ? t('legend.hideOthers') : t('legend.showOthers')}
        </button>
        {s.showOthers && (
          <>
            <button type="button" className="tab legend-btn" aria-pressed={!s.colorOthers} onClick={() => s.setColorOthers(!s.colorOthers)}>
              {s.colorOthers ? t('legend.grey') : t('legend.color')}
            </button>
            <label className="legend-range">
              <span>{t('legend.range')}</span>
              <input type="range" min={0} max={RANGE_STEPS.length - 1} step={1} value={idx}
                aria-valuetext={s.range === 0 ? t('legend.coast') : `${s.range} km`}
                onChange={e => s.setRange(RANGE_STEPS[Number(e.target.value)])} />
              <span className="n" style={{ minWidth: 70 }}>{s.range === 0 ? t('legend.coast') : `${s.range} km`}</span>
            </label>
            <button type="button" className="tab legend-btn" aria-pressed={s.range === 0} onClick={() => s.setRange(s.range === 0 ? 75 : 0)}>
              {t('legend.coast')}
            </button>
            {s.range === 0 && (s.coastPending || s.coastError || s.coastCount != null) && (
              <span className="n" style={{ color: s.coastError ? 'var(--bad-fg)' : 'var(--fg-62)' }}>
                {s.coastError ?? (s.coastPending ? '…' : `${s.coastCount}`)}
              </span>
            )}
          </>
        )}
      </div>
      <div className="legend-types" role="group" aria-label={t('legend.toggleType')}>
        {types.map(k => (
          <button key={k} type="button" className="legend-chip" aria-pressed={!s.hidden.has(k)} title={t('legend.toggleType')} onClick={() => s.toggleType(k)}>
            {hull(k === 'flow' || s.colorOthers ? CATEGORY_COLOR[k] : CATEGORY_COLOR.gra)}{t(`cat.${k}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
