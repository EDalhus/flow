import type { CallStatus } from './types.ts';

// Status settes aldri manuelt. Rekkefølge:
//   avlyst → ferdig (kaibok levert) → AIS (ved kai / kaibok mangler / på vei) → tid → planlagt.
// Uten AIS-data for båten faller vi tilbake til klokka, og merker det med basis 'tid'.

export interface StatusInput {
  eta: string;
  etd: string;
  arrived_at: string | null;
  departed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  /** Siste AIS-posisjon for båten, hvis den finnes. */
  ais?: { fetched_at: string; sog: number | null; in_geofence: boolean } | null;
}

export interface StatusResult {
  status: CallStatus;
  basis: 'kaibok' | 'ais' | 'tid' | 'plan';
}

export interface StatusOptions {
  missingAfterMinutes: number;
  aisFreshMinutes?: number;
  onTheWayHours?: number;
}

const MIN = 60_000;

export function deriveStatus(c: StatusInput, now: Date, opts: StatusOptions): StatusResult {
  const t = now.getTime();
  const eta = Date.parse(c.eta);
  const etd = Date.parse(c.etd);

  if (c.cancelled_at) return { status: 'avlyst', basis: 'plan' };
  if (c.completed_at) return { status: 'ferdig', basis: 'kaibok' };

  // Geofence-tidsstempler fra AIS er sikreste kilde.
  if (c.departed_at) return { status: 'kaibok_mangler', basis: 'ais' };
  if (c.arrived_at) return { status: 'ved_kai', basis: 'ais' };

  const ais = c.ais && t - Date.parse(c.ais.fetched_at) <= (opts.aisFreshMinutes ?? 15) * MIN ? c.ais : null;
  if (ais?.in_geofence) return { status: 'ved_kai', basis: 'ais' };

  if (t >= etd + opts.missingAfterMinutes * MIN) return { status: 'kaibok_mangler', basis: 'tid' };

  if (ais) {
    const moving = (ais.sog ?? 0) > 1;
    if (moving && eta - t <= (opts.onTheWayHours ?? 12) * 60 * MIN) return { status: 'paa_vei', basis: 'ais' };
    return { status: 'planlagt', basis: 'plan' };
  }

  // Ingen AIS: anta at båten ligger ved kai mellom ETA og ETD.
  if (t >= eta) return { status: 'ved_kai', basis: 'tid' };
  return { status: 'planlagt', basis: 'plan' };
}

/** Status som teller med i kollisjonssjekk (ikke ferdige eller avlyste anløp). */
export function isActive(status: CallStatus): boolean {
  return status !== 'ferdig' && status !== 'avlyst';
}
