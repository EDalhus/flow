import type { BulkGroup, BulkLogEntry, BulkOrderView, BulkReport, BulkReportRow, BulkWeighing } from '../../shared/api.ts';
import { bulkPhase, minutesBetween } from '../../shared/domain/bulk.ts';
import { bulkStepDone, type BulkOrderCreate } from '../../shared/schemas.ts';
import { addDays, osloToUtc, serviceDate } from '../../shared/time.ts';
import { folgeseddelPdf } from '../lib/folgeseddel.ts';
import { fail, newId, nowIso } from '../lib/http.ts';

// Bulkutlevering: lasting av bestillinger, lastemotoren (felles for sjåfør og kontor), logg,
// følgeseddel, dagens veiinger og rapporter.

type OrderRow = {
  id: string; truck: string; destination: string | null; status: BulkOrderView['status']; expected_at: string | null; notes: string | null;
  created_at: string; started_at: string | null; finished_at: string | null; project_no: string | null; so_number: string | null;
  stopped_at: string | null; delivery_no: number | null; pdf_key: string | null; booked_by: string | null;
  u_id: string | null; u_name: string | null; u_short: string | null; u_initials: string | null;
  d_id: string | null; d_name: string | null; d_phone: string | null;
  v_id: string | null; v_reg: string | null; v_desc: string | null;
  h_id: string | null; h_name: string | null; h_own: number | null;
  c_id: string | null; c_name: string | null;
};
type StepRow = BulkOrderView['steps'][number] & { order_id: string };

const ORDER_SELECT = `
  SELECT o.id, o.truck, o.destination, o.status, o.expected_at, o.notes, o.created_at, o.started_at, o.finished_at, o.project_no, o.so_number,
         o.stopped_at, o.delivery_no, o.pdf_key, o.booked_by,
         u.id AS u_id, u.name AS u_name, u.short_name AS u_short, u.initials AS u_initials,
         d.id AS d_id, d.name AS d_name, d.phone AS d_phone,
         v.id AS v_id, v.reg_no AS v_reg, v.description AS v_desc,
         h.id AS h_id, h.name AS h_name, h.own AS h_own,
         c.id AS c_id, c.name AS c_name
  FROM bulk_orders o
  LEFT JOIN users u ON u.id = o.driver_id
  LEFT JOIN drivers d ON d.id = o.driver_profile_id
  LEFT JOIN vehicles v ON v.id = o.vehicle_id
  LEFT JOIN haulers h ON h.id = coalesce(v.hauler_id, d.hauler_id)
  LEFT JOIN bulk_customers c ON c.id = o.customer_id`;

export async function loadBulk(db: D1Database, where: string, params: unknown[], order = `CASE o.status WHEN 'lastes' THEN 0 WHEN 'bestilt' THEN 1 ELSE 2 END, coalesce(o.expected_at, o.created_at)`): Promise<BulkOrderView[]> {
  const [orders, steps] = await db.batch([
    db.prepare(`${ORDER_SELECT} WHERE ${where} ORDER BY ${order}`).bind(...params),
    db.prepare(`SELECT s.id, s.order_id, s.seq, s.quality_id, q.name AS quality_name, q.color, s.tonnes, s.target, s.started_at, s.finished_at, s.weighed_tonnes
                FROM bulk_order_steps s JOIN bulk_qualities q ON q.id = s.quality_id
                WHERE s.order_id IN (SELECT o.id ${ORDER_SELECT.slice(ORDER_SELECT.indexOf('FROM'))} WHERE ${where}) ORDER BY s.seq`).bind(...params),
  ]);
  const byOrder = Map.groupBy(steps.results as StepRow[], s => s.order_id);
  return (orders.results as OrderRow[]).map(o => {
    const st = (byOrder.get(o.id) ?? []).map(({ order_id: _o, ...s }) => s);
    const weighed = st.every(s => s.weighed_tonnes != null) && st.length ? round(st.reduce((t, s) => t + (s.weighed_tonnes ?? 0), 0)) : null;
    return {
      id: o.id, truck: o.v_reg ? `${o.v_reg}${o.v_desc ? ` · ${o.v_desc}` : ''}` : o.truck, destination: o.c_name ?? o.destination,
      driver: o.u_id ? { id: o.u_id, name: o.u_name ?? '', short_name: o.u_short ?? '', initials: o.u_initials ?? '' } : null,
      status: o.status, expected_at: o.expected_at, notes: o.notes, created_at: o.created_at, started_at: o.started_at, finished_at: o.finished_at,
      total_tonnes: st.reduce((t, s) => t + s.tonnes, 0), weighed_tonnes: weighed,
      driver_profile: o.d_id ? { id: o.d_id, name: o.d_name ?? '', phone: o.d_phone ?? '' } : null,
      vehicle: o.v_id ? { id: o.v_id, reg_no: o.v_reg ?? '', description: o.v_desc } : null,
      hauler: o.h_id ? { id: o.h_id, name: o.h_name ?? '', own: !!o.h_own } : null,
      customer: o.c_id ? { id: o.c_id, name: o.c_name ?? '' } : null,
      project_no: o.project_no, so_number: o.so_number, stopped_at: o.stopped_at, delivery_no: o.delivery_no, has_pdf: o.status === 'ferdig' && o.delivery_no != null,
      booked_by: o.booked_by === 'sjafor' ? 'sjafor' : 'kontor', steps: st,
    };
  });
}
export const loadBulkOne = async (db: D1Database, id: string) => (await loadBulk(db, 'o.id = ?', [id]))[0] ?? null;

// ---------------------------------------------------------------- bestilling

export type Actor = { userId: string | null; driverId: string | null; name: string };

/** Ny bestilling: sjekker bil, kunde (prosjektnummer når kunden krever det), sjåfør og kvaliteter. */
export async function createBulkOrder(db: D1Database, i: BulkOrderCreate, actor: Actor, driverId: string | null, haulerId?: string) {
  const [vehicle, customer, driver, qualities] = await db.batch([
    db.prepare('SELECT id, reg_no, description, hauler_id, has_trailer FROM vehicles WHERE id = ? AND active = 1').bind(i.vehicle_id),
    db.prepare('SELECT id, name, requires_project FROM bulk_customers WHERE id = ? AND active = 1').bind(i.customer_id),
    db.prepare('SELECT id, hauler_id FROM drivers WHERE id = ? AND active = 1').bind(driverId ?? ''),
    db.prepare(`SELECT count(*) AS n FROM bulk_qualities WHERE active = 1 AND id IN (SELECT value FROM json_each(?))`)
      .bind(JSON.stringify([...new Set(i.steps.map(s => s.quality_id))])),
  ]);
  const v = vehicle.results[0] as { id: string; reg_no: string; description: string | null; hauler_id: string; has_trailer: number } | undefined;
  const cu = customer.results[0] as { id: string; name: string; requires_project: number } | undefined;
  if (!v) throw fail(400, 'Ukjent bil.', { field: 'vehicle_id' });
  if (haulerId && v.hauler_id !== haulerId) throw fail(403, 'Bilen hører til et annet transportfirma.', { field: 'vehicle_id' });
  if (!cu) throw fail(400, 'Ukjent kunde.', { field: 'customer_id' });
  if (cu.requires_project && !i.project_no) throw fail(400, `${cu.name} krever prosjektnummer.`, { field: 'project_no' });
  if (driverId && !driver.results.length) throw fail(400, 'Ukjent sjåfør.', { field: 'driver_id' });
  if ((qualities.results[0] as { n: number }).n !== new Set(i.steps.map(s => s.quality_id)).size) throw fail(400, 'Ukjent saltkvalitet.', { field: 'steps' });
  if (i.steps.some(s => s.target === 'henger') && !v.has_trailer) throw fail(400, 'Bilen er registrert uten henger.', { field: 'steps' });

  const id = newId('bo');
  await db.batch([
    db.prepare(`INSERT INTO bulk_orders (id, truck, destination, driver_id, expected_at, notes, driver_profile_id, vehicle_id, customer_id, project_no, so_number, booked_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, v.reg_no, cu.name, actor.userId, i.expected_at ?? null, i.notes, driverId, v.id, cu.id, i.project_no, i.so_number ?? null,
        actor.driverId ? 'sjafor' : actor.userId),
    ...i.steps.map((s, n) => db.prepare(`INSERT INTO bulk_order_steps (id, order_id, seq, quality_id, tonnes, target, pause_after_sec) VALUES (?, ?, ?, ?, ?, ?, 0)`)
      .bind(newId('bs'), id, n + 1, s.quality_id, s.tonnes, s.target)),
    log(db, id, actor, 'booked', { customer: cu.name, vehicle: v.reg_no, tonnes: i.steps.reduce((t, s) => t + s.tonnes, 0), expected_at: i.expected_at ?? null }),
  ]);
  return (await loadBulkOne(db, id))!;
}

export const log = (db: D1Database, orderId: string, a: Actor, kind: string, data: unknown = {}) =>
  db.prepare('INSERT INTO bulk_log (order_id, user_id, driver_id, kind, data) VALUES (?, ?, ?, ?, ?)')
    .bind(orderId, a.userId, a.driverId, kind, JSON.stringify(data));

export async function loadBulkLog(db: D1Database, orderId: string): Promise<BulkLogEntry[]> {
  const { results } = await db.prepare(`SELECT l.id, l.at, l.kind, l.data, coalesce(d.name, u.short_name) AS by_name
                                        FROM bulk_log l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN drivers d ON d.id = l.driver_id
                                        WHERE l.order_id = ? ORDER BY l.at DESC, l.id DESC`).bind(orderId)
    .all<{ id: number; at: string; kind: string; data: string; by_name: string | null }>();
  return results.map(r => ({ id: r.id, at: r.at, kind: r.kind, data: JSON.parse(r.data), by: r.by_name }));
}

// ---------------------------------------------------------------- lastemotor

export type BulkAction = 'start' | 'step-done' | 'stop' | 'continue' | 'cancel';

/**
 * Sjåføren styrer lastingen: start → steg ferdig (veid tonn) → start neste steg (henger) → ferdig.
 * Nødstopp stopper til «Fortsett». Når siste steg er veid, får lastingen følgeseddel-nummer og PDF.
 */
export async function bulkAct(env: Env, order: BulkOrderView, action: BulkAction, actor: Actor, weighed?: number): Promise<BulkOrderView> {
  const db = env.DB;
  const now = nowIso();
  const phase = bulkPhase(order.status, order.steps, order.stopped_at);
  const stmts: D1PreparedStatement[] = [];
  let finished = false;
  switch (action) {
    case 'start': {
      if (phase.kind === 'venter') {
        const first = order.steps[0];
        stmts.push(
          db.prepare(`UPDATE bulk_orders SET status = 'lastes', started_at = coalesce(started_at, ?), version = version + 1 WHERE id = ?`).bind(now, order.id),
          db.prepare('UPDATE bulk_order_steps SET started_at = ? WHERE id = ?').bind(now, first.id),
          log(db, order.id, actor, 'started', { step: first.seq, target: first.target }),
        );
      } else if (phase.kind === 'pause') {
        const next = order.steps.find(s => s.seq === phase.next)!;
        stmts.push(
          db.prepare('UPDATE bulk_order_steps SET started_at = ? WHERE id = ?').bind(now, next.id),
          log(db, order.id, actor, 'started', { step: next.seq, target: next.target }),
        );
      } else throw fail(409, 'Lastingen kan ikke startes nå.');
      break;
    }
    case 'step-done': {
      if (phase.kind !== 'laster') throw fail(409, 'Ingen steg lastes nå.');
      if (weighed == null) throw fail(400, 'Skriv inn veid tonn.', { field: 'weighed_tonnes' });
      const cur = order.steps.find(s => s.seq === phase.step)!;
      const source = actor.driverId ? 'sjafor' : 'kontor';
      stmts.push(
        db.prepare('UPDATE bulk_order_steps SET finished_at = ?, weighed_tonnes = ?, weighed_source = ? WHERE id = ?').bind(now, weighed, source, cur.id),
        log(db, order.id, actor, 'weighed', { step: cur.seq, target: cur.target, quality: cur.quality_name, ordered: cur.tonnes, weighed }),
      );
      if (cur.seq === Math.max(...order.steps.map(s => s.seq))) {
        finished = true;
        stmts.push(
          db.prepare(`UPDATE bulk_orders SET status = 'ferdig', finished_at = ?, version = version + 1,
                        delivery_no = (SELECT coalesce(max(delivery_no), 1000) + 1 FROM bulk_orders) WHERE id = ?`).bind(now, order.id),
          log(db, order.id, actor, 'finished', {}),
        );
      }
      break;
    }
    case 'stop': {
      if (order.status !== 'lastes' || order.stopped_at) throw fail(409, 'Nødstopp kan bare trykkes under lasting.');
      stmts.push(
        db.prepare('UPDATE bulk_orders SET stopped_at = ?, version = version + 1 WHERE id = ?').bind(now, order.id),
        log(db, order.id, actor, 'stopped', { step: phase.kind === 'laster' ? phase.step : null }),
        // Produksjonen får varsel i bjella.
        db.prepare(`INSERT INTO notifications (id, user_id, kind, text)
                    SELECT 'n_' || lower(hex(randomblob(10))), ur.user_id, 'order', ?
                    FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE ur.role = 'produksjon' AND u.active = 1`)
          .bind(`NØDSTOPP ved utlastingen: ${order.truck} (${actor.name})`),
      );
      break;
    }
    case 'continue': {
      if (!order.stopped_at) throw fail(409, 'Lastingen er ikke stoppet.');
      stmts.push(
        db.prepare('UPDATE bulk_orders SET stopped_at = NULL, version = version + 1 WHERE id = ?').bind(order.id),
        log(db, order.id, actor, 'continued', {}),
      );
      break;
    }
    case 'cancel': {
      if (order.status === 'ferdig' || order.status === 'avlyst') throw fail(409, 'Bestillingen er allerede ferdig eller avlyst.');
      if (actor.driverId && order.status !== 'bestilt') throw fail(409, 'Lastingen er startet. Kontakt kontoret.');
      stmts.push(
        db.prepare(`UPDATE bulk_orders SET status = 'avlyst', finished_at = ?, stopped_at = NULL, version = version + 1 WHERE id = ?`).bind(now, order.id),
        log(db, order.id, actor, 'cancelled', {}),
      );
      break;
    }
  }
  await db.batch(stmts);
  let view = (await loadBulkOne(db, order.id))!;
  if (finished) view = await storePdf(env, view);
  return view;
}

/** Lager følgeseddelen og lagrer den i R2. Feiler den, kan den lages på nytt når noen åpner den. */
export async function storePdf(env: Env, o: BulkOrderView): Promise<BulkOrderView> {
  try {
    const key = `folgesedler/${o.delivery_no}-${o.id}.pdf`;
    await env.PHOTOS.put(key, await folgeseddelPdf(o), { httpMetadata: { contentType: 'application/pdf' } });
    await env.DB.prepare('UPDATE bulk_orders SET pdf_key = ? WHERE id = ?').bind(key, o.id).run();
    return { ...o, has_pdf: true };
  } catch (e) {
    console.error('Følgeseddel feilet', e);
    return o;
  }
}

/** Følgeseddelen som svar (lagret PDF, eller laget på nytt). */
export async function pdfResponse(env: Env, o: BulkOrderView): Promise<Response> {
  if (o.status !== 'ferdig' || !o.delivery_no) throw fail(409, 'Følgeseddel lages når lastingen er ferdig.');
  const row = await env.DB.prepare('SELECT pdf_key FROM bulk_orders WHERE id = ?').bind(o.id).first<{ pdf_key: string | null }>();
  const obj = row?.pdf_key ? await env.PHOTOS.get(row.pdf_key) : null;
  const body = obj ? await obj.arrayBuffer() : await folgeseddelPdf(o);
  return new Response(body, {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="folgeseddel-${o.delivery_no}.pdf"`, 'cache-control': 'private, max-age=60' },
  });
}

// ---------------------------------------------------------------- veiinger og rapporter

const dayRange = (from: string, to: string) => [osloToUtc(from, 0), osloToUtc(addDays(to, 1), 0)];

/** Alle veiinger (ferdige steg) i perioden, nyeste først. */
export async function loadWeighings(db: D1Database, from: string, to: string): Promise<BulkWeighing[]> {
  const [a, b] = dayRange(from, to);
  const orders = await loadBulk(db, `o.id IN (SELECT order_id FROM bulk_order_steps WHERE finished_at >= ? AND finished_at < ?)`, [a, b]);
  return orders.flatMap(o => o.steps.filter(s => s.finished_at && s.finished_at >= a && s.finished_at < b).map(s => ({
    step_id: s.id, order_id: o.id, at: s.finished_at!, delivery_no: o.delivery_no, quality_name: s.quality_name, color: s.color, target: s.target,
    ordered: s.tonnes, weighed: s.weighed_tonnes, vehicle: o.vehicle?.reg_no ?? o.truck, driver: o.driver_profile?.name ?? o.driver?.name ?? null,
    hauler: o.hauler?.name ?? null, customer: o.customer?.name ?? o.destination, project_no: o.project_no, so_number: o.so_number,
  }))).sort((x, y) => y.at.localeCompare(x.at));
}

/** Rapport over ferdige lastinger i perioden, gruppert etter kvalitet, kunde, bil, sjåfør, transportør, prosjekt eller dag. */
export async function bulkReport(db: D1Database, from: string, to: string, group: BulkGroup): Promise<BulkReport> {
  const [a, b] = dayRange(from, to);
  const orders = await loadBulk(db, `o.status = 'ferdig' AND o.finished_at >= ? AND o.finished_at < ?`, [a, b]);
  const rows = new Map<string, BulkReportRow & { minutes: number[]; orderIds: Set<string> }>();
  const add = (key: string, label: string, orderId: string, ordered: number, weighed: number, minutes: number | null) => {
    const r = rows.get(key) ?? { key, label, loads: 0, ordered: 0, weighed: 0, minutes_avg: null, minutes: [], orderIds: new Set() };
    if (!r.orderIds.has(orderId)) { r.orderIds.add(orderId); r.loads++; if (minutes != null) r.minutes.push(minutes); }
    r.ordered += ordered; r.weighed += weighed;
    rows.set(key, r);
  };
  for (const o of orders) {
    const minutes = minutesBetween(o.started_at, o.finished_at);
    if (group === 'kvalitet') {
      for (const s of o.steps) add(s.quality_id, s.quality_name, o.id, s.tonnes, s.weighed_tonnes ?? 0, minutes);
      continue;
    }
    const [key, label] =
      group === 'kunde' ? [o.customer?.id ?? o.destination ?? '-', o.customer?.name ?? o.destination ?? '–']
      : group === 'bil' ? [o.vehicle?.id ?? o.truck, o.vehicle?.reg_no ?? o.truck]
      : group === 'sjafor' ? [o.driver_profile?.id ?? o.driver?.id ?? '-', o.driver_profile?.name ?? o.driver?.name ?? '–']
      : group === 'transportor' ? [o.hauler?.id ?? '-', o.hauler?.name ?? '–']
      : group === 'prosjekt' ? [o.project_no ?? '-', o.project_no ?? '–']
      : [serviceDate(o.finished_at!), serviceDate(o.finished_at!)];
    add(key, label, o.id, o.total_tonnes, o.steps.reduce((t, s) => t + (s.weighed_tonnes ?? 0), 0), minutes);
  }
  const out = [...rows.values()].map(({ minutes, orderIds: _o, ...r }) => ({
    ...r, ordered: round(r.ordered), weighed: round(r.weighed), minutes_avg: minutes.length ? Math.round(minutes.reduce((t, m) => t + m, 0) / minutes.length) : null,
  })).sort((x, y) => (group === 'dag' ? x.key.localeCompare(y.key) : y.weighed - x.weighed));
  const all = orders.map(o => minutesBetween(o.started_at, o.finished_at)).filter((m): m is number => m != null);
  return {
    from, to, group, rows: out,
    total: {
      loads: orders.length, ordered: round(orders.reduce((t, o) => t + o.total_tonnes, 0)),
      weighed: round(orders.reduce((t, o) => t + o.steps.reduce((u, s) => u + (s.weighed_tonnes ?? 0), 0), 0)),
      minutes_avg: all.length ? Math.round(all.reduce((t, m) => t + m, 0) / all.length) : null,
    },
  };
}
const round = (n: number) => Math.round(n * 100) / 100;

/** Veid tonn fra «Steg ferdig» (400 med melding hvis det mangler eller er ugyldig). */
export async function readWeighed(req: Request): Promise<number> {
  const r = bulkStepDone.safeParse(await req.json().catch(() => ({})));
  if (!r.success) throw fail(400, 'Skriv inn veid tonn.', { field: 'weighed_tonnes' });
  return r.data.weighed_tonnes;
}
