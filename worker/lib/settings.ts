import type { CapacityFor } from '../../shared/domain/collisions.ts';
import { CREW_ROLES, DEFAULT_SETTINGS, type Capacity, type CrewRole, type Settings } from '../../shared/domain/types.ts';

export async function loadSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of results) if (r.key in DEFAULT_SETTINGS) merged[r.key] = JSON.parse(r.value);
  return merged as unknown as Settings;
}

/** Kapasitet per dag: antall på vakt per rolle, eller standard fra settings når vakt ikke er registrert. */
export async function loadCapacity(db: D1Database, settings: Settings, from: string, to: string): Promise<CapacityFor> {
  const { results } = await db
    .prepare('SELECT service_date, crew_role, count(*) AS n FROM shifts WHERE service_date BETWEEN ? AND ? GROUP BY service_date, crew_role')
    .bind(from, to)
    .all<{ service_date: string; crew_role: CrewRole; n: number }>();
  const byDate = new Map<string, Capacity>();
  for (const r of results) {
    const cap = byDate.get(r.service_date) ?? (Object.fromEntries(CREW_ROLES.map(k => [k, 0])) as Capacity);
    cap[r.crew_role] = r.n;
    byDate.set(r.service_date, cap);
  }
  return date => byDate.get(date) ?? settings.capacity;
}
