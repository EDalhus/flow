import type { BoatView, QuayLogView, UserRef } from '../../shared/api.ts';
import { autoFlag, effectiveFlag } from '../../shared/domain/flags.ts';
import { deriveStatus } from '../../shared/domain/status.ts';
import type { CallType, Category, Flag, FlagRules, Settings } from '../../shared/domain/types.ts';
import { todayOslo } from '../../shared/time.ts';

/** Regner ut snitt og automatisk flagg for en båt på nytt fra kaibøkene. */
export async function recomputeBoat(db: D1Database, boatId: string, rules: FlagRules) {
  const [agg, recent] = await db.batch([
    db.prepare(`
      SELECT count(*) AS n, avg(ql.r_punctuality) AS p, avg(ql.r_cooperation) AS c, avg(ql.r_equipment) AS e, max(ql.delivered_at) AS last
      FROM quay_logs ql JOIN port_calls pc ON pc.id = ql.port_call_id WHERE pc.boat_id = ?`).bind(boatId),
    db.prepare(`
      SELECT ql.had_deviation, (SELECT group_concat(category) FROM quay_log_categories c WHERE c.quay_log_id = ql.id) AS cats
      FROM quay_logs ql JOIN port_calls pc ON pc.id = ql.port_call_id
      WHERE pc.boat_id = ? ORDER BY ql.delivered_at DESC LIMIT 10`).bind(boatId),
  ]);
  const a = agg.results[0] as { n: number; p: number | null; c: number | null; e: number | null; last: string | null };
  const total = a.n ? ((a.p ?? 0) + (a.c ?? 0) + (a.e ?? 0)) / 3 : null;
  const flag = autoFlag(
    {
      count: a.n, avg_punctuality: a.p, avg_cooperation: a.c, avg_equipment: a.e, avg_total: total,
      recent: (recent.results as { had_deviation: number; cats: string | null }[]).map(r => ({
        had_deviation: !!r.had_deviation, categories: (r.cats ? r.cats.split(',') : []) as Category[],
      })),
    },
    rules,
  );
  await db
    .prepare(`
      UPDATE boats SET rating_count = ?, avg_punctuality = ?, avg_cooperation = ?, avg_equipment = ?, avg_total = ?,
        last_log_at = ?, flag_auto = ?, flag_auto_reason = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`)
    .bind(a.n, a.p, a.c, a.e, total, a.last, flag.flag, flag.reason, boatId)
    .run();
  return { rating_count: a.n, avg_total: total, flag_auto: flag.flag, flag_auto_reason: flag.reason };
}

type BoatRow = {
  id: string; name: string; imo: string | null; mmsi: string | null; callsign: string | null; note: string | null;
  ship_contact: string | null; ship_phone: string | null;
  agent_id: string | null; agent_name: string | null; agent_phone: string | null;
  flag_auto: Flag; flag_auto_reason: string | null; flag_override: Flag | null; flag_override_reason: string | null;
  flag_override_at: string | null; ob_id: string | null; ob_name: string | null; ob_short: string | null; ob_initials: string | null;
  rating_count: number; avg_punctuality: number | null; avg_cooperation: number | null; avg_equipment: number | null;
  avg_total: number | null; last_log_at: string | null;
  next_id: string | null; next_eta: string | null; next_etd: string | null; next_known: number | null; next_quay: string | null;
};

export async function loadBoats(db: D1Database, settings: Settings, id?: string, now = new Date()): Promise<BoatView[]> {
  const { results } = await db
    .prepare(`
      SELECT b.id, b.name, b.imo, b.mmsi, b.callsign, b.note, b.ship_contact, b.ship_phone,
             ag.id AS agent_id, ag.name AS agent_name, ag.phone AS agent_phone,
             b.flag_auto, b.flag_auto_reason, b.flag_override, b.flag_override_reason, b.flag_override_at,
             ob.id AS ob_id, ob.name AS ob_name, ob.short_name AS ob_short, ob.initials AS ob_initials,
             b.rating_count, b.avg_punctuality, b.avg_cooperation, b.avg_equipment, b.avg_total, b.last_log_at,
             n.id AS next_id, n.eta AS next_eta, n.etd AS next_etd, n.time_known AS next_known, nq.name AS next_quay
      FROM boats b
      LEFT JOIN agents ag ON ag.id = b.agent_id
      LEFT JOIN users ob ON ob.id = b.flag_override_by
      LEFT JOIN port_calls n ON n.id = (
        SELECT pc.id FROM port_calls pc
        WHERE pc.boat_id = b.id AND pc.source = 'app' AND pc.completed_at IS NULL AND pc.cancelled_at IS NULL
          AND pc.service_date >= ? AND NOT EXISTS (SELECT 1 FROM quay_logs ql WHERE ql.port_call_id = pc.id)
        ORDER BY pc.eta LIMIT 1)
      LEFT JOIN quays nq ON nq.id = n.quay_id
      WHERE b.active = 1 ${id ? 'AND b.id = ?' : ''}
      ORDER BY b.avg_total IS NULL, b.avg_total DESC, b.name`)
    .bind(...(id ? [todayOslo(now), id] : [todayOslo(now)]))
    .all<BoatRow>();

  return results.map(b => {
    const flag = effectiveFlag(b);
    return {
      id: b.id, name: b.name, imo: b.imo, mmsi: b.mmsi, callsign: b.callsign, note: b.note,
      agent: b.agent_id ? { id: b.agent_id, name: b.agent_name ?? '', phone: b.agent_phone } : null,
      ship_contact: b.ship_contact, ship_phone: b.ship_phone,
      flag, flag_reason: b.flag_override ? b.flag_override_reason : b.flag_auto_reason, flag_overridden: !!b.flag_override,
      flag_auto: b.flag_auto, flag_auto_reason: b.flag_auto_reason, flag_override: b.flag_override,
      flag_override_reason: b.flag_override_reason, flag_override_at: b.flag_override_at,
      flag_override_by: b.ob_id ? { id: b.ob_id, name: b.ob_name ?? '', short_name: b.ob_short ?? '', initials: b.ob_initials ?? '' } : null,
      rating_count: b.rating_count, avg_punctuality: b.avg_punctuality, avg_cooperation: b.avg_cooperation,
      avg_equipment: b.avg_equipment, avg_total: b.avg_total, last_log_at: b.last_log_at,
      next_call: b.next_id
        ? {
            id: b.next_id, eta: b.next_eta!, etd: b.next_etd!, time_known: b.next_known !== 0, quay_name: b.next_quay ?? '',
            status: deriveStatus(
              { eta: b.next_eta!, etd: b.next_etd!, time_known: b.next_known !== 0, arrived_at: null, departed_at: null, completed_at: null, cancelled_at: null },
              now, { missingAfterMinutes: settings.quay_log_missing_after_minutes },
            ).status,
          }
        : null,
    };
  });
}

type LogRow = {
  id: string; port_call_id: string; boat_id: string; boat_name: string; quay_id: string; quay_name: string; quay_nickname: string | null; quay_company: string | null;
  service_date: string; type: CallType; eta: string; etd: string;
  resp_id: string | null; resp_name: string | null; resp_short: string | null; resp_initials: string | null;
  had_deviation: number; cats: string | null; description: string | null;
  r_punctuality: number; r_cooperation: number; r_equipment: number; boat_note: string | null;
  by_id: string | null; by_name: string | null; by_short: string | null; by_initials: string | null; delivered_at: string;
  crew: string | null; photos: string | null;
};

export interface LogFilter {
  sinceIso?: string;
  boatId?: string;
  id?: string;
  deviation?: boolean;
  limit?: number;
}

export async function loadQuayLogs(db: D1Database, f: LogFilter): Promise<QuayLogView[]> {
  const cond: string[] = [];
  const params: unknown[] = [];
  if (f.sinceIso) { cond.push('ql.delivered_at >= ?'); params.push(f.sinceIso); }
  if (f.boatId) { cond.push('pc.boat_id = ?'); params.push(f.boatId); }
  if (f.id) { cond.push('ql.id = ?'); params.push(f.id); }
  if (f.deviation !== undefined) { cond.push('ql.had_deviation = ?'); params.push(f.deviation ? 1 : 0); }
  params.push(f.limit ?? 500);

  const { results } = await db
    .prepare(`
      SELECT ql.id, ql.port_call_id, b.id AS boat_id, b.name AS boat_name, q.id AS quay_id, q.name AS quay_name, q.nickname AS quay_nickname, q.company AS quay_company,
             pc.service_date, pc.type, pc.eta, pc.etd,
             r.id AS resp_id, r.name AS resp_name, r.short_name AS resp_short, r.initials AS resp_initials,
             ql.had_deviation, (SELECT group_concat(category) FROM quay_log_categories c WHERE c.quay_log_id = ql.id) AS cats,
             ql.description, ql.r_punctuality, ql.r_cooperation, ql.r_equipment, ql.boat_note,
             d.id AS by_id, d.name AS by_name, d.short_name AS by_short, d.initials AS by_initials, ql.delivered_at,
             (SELECT json_group_array(json_object('id', u.id, 'name', u.name, 'short_name', u.short_name, 'initials', u.initials))
                FROM crew_slots cs JOIN users u ON u.id = cs.user_id WHERE cs.port_call_id = pc.id ORDER BY cs.sort) AS crew,
             (SELECT json_group_array(json_object('id', ph.id, 'thumb', ph.thumb_key IS NOT NULL))
                FROM quay_log_photos ph WHERE ph.quay_log_id = ql.id ORDER BY ph.created_at) AS photos
      FROM quay_logs ql
      JOIN port_calls pc ON pc.id = ql.port_call_id
      JOIN boats b ON b.id = pc.boat_id
      JOIN quays q ON q.id = pc.quay_id
      LEFT JOIN users r ON r.id = pc.responsible_user_id
      LEFT JOIN users d ON d.id = ql.delivered_by
      ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
      ORDER BY ql.delivered_at DESC
      LIMIT ?`)
    .bind(...params)
    .all<LogRow>();

  const ref = (id: string | null, name: string | null, short: string | null, initials: string | null): UserRef | null =>
    id ? { id, name: name ?? '', short_name: short ?? '', initials: initials ?? '' } : null;

  return results.map(l => ({
    id: l.id, port_call_id: l.port_call_id, boat: { id: l.boat_id, name: l.boat_name },
    quay: { id: l.quay_id, name: l.quay_name, nickname: l.quay_nickname, company: l.quay_company },
    service_date: l.service_date, type: l.type, eta: l.eta, etd: l.etd,
    responsible: ref(l.resp_id, l.resp_name, l.resp_short, l.resp_initials),
    crew: JSON.parse(l.crew ?? '[]') as UserRef[],
    had_deviation: !!l.had_deviation, categories: (l.cats ? l.cats.split(',') : []) as Category[], description: l.description,
    ratings: { punctuality: l.r_punctuality, cooperation: l.r_cooperation, equipment: l.r_equipment },
    avg: (l.r_punctuality + l.r_cooperation + l.r_equipment) / 3,
    boat_note: l.boat_note,
    photos: (JSON.parse(l.photos ?? '[]') as { id: string; thumb: number }[]).map(p => ({
      id: p.id, url: `/api/photos/${p.id}`, thumb_url: p.thumb ? `/api/photos/${p.id}?thumb=1` : null,
    })),
    delivered_by: ref(l.by_id, l.by_name, l.by_short, l.by_initials),
    delivered_at: l.delivered_at,
  }));
}
