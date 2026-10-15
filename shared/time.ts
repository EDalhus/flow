// Tidshjelpere. All lagring er UTC; kaia lever i Europe/Oslo.

export const TZ = 'Europe/Oslo';

const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});

function osloParts(d: Date) {
  const p: Record<string, string> = {};
  for (const { type, value } of partsFmt.formatToParts(d)) p[type] = value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second),
  };
}

/** Oslo-forskyvning i minutter for et gitt UTC-tidspunkt (60 om vinteren, 120 om sommeren). */
function offsetMinutes(utcMs: number): number {
  const p = osloParts(new Date(utcMs));
  const asUtc = Date.parse(`${p.date}T00:00:00Z`) + ((p.hour * 60 + p.minute) * 60 + p.second) * 1000;
  return Math.round((asUtc - utcMs) / 60000);
}

/** Lokal Oslo-dato + klokkeslett ("07:30" eller minutter etter midnatt) → ISO UTC. */
export function osloToUtc(date: string, time: string | number): string {
  const minutes = typeof time === 'number' ? time : hmToMinutes(time);
  const naive = Date.parse(`${date}T00:00:00Z`) + minutes * 60000;
  let utc = naive - offsetMinutes(naive) * 60000;
  utc = naive - offsetMinutes(utc) * 60000; // andre runde treffer riktig rundt sommertidsskifte
  return new Date(utc).toISOString();
}

/** ISO UTC → lokal Oslo-dato ("2026-10-14"). */
/** Anløp uten kjent klokkeslett lagres som hele dagen. */
export const wholeDay = (date: string) => ({ eta: osloToUtc(date, 0), etd: osloToUtc(date, 23 * 60 + 59) });

export function serviceDate(iso: string | Date): string {
  return osloParts(typeof iso === 'string' ? new Date(iso) : iso).date;
}

/** ISO UTC → lokalt klokkeslett ("07:30"). */
export function osloTime(iso: string | Date): string {
  const p = osloParts(typeof iso === 'string' ? new Date(iso) : iso);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function todayOslo(now: Date = new Date()): string {
  return osloParts(now).date;
}

export function hmToMinutes(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!m) throw new Error(`Ugyldig klokkeslett: ${hm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Legger til dager på en "YYYY-MM-DD"-dato. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO-uke for en "YYYY-MM-DD"-dato. */
export function isoWeek(date: string): { year: number; week: number } {
  const d = new Date(`${date}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // man = 0
  d.setUTCDate(d.getUTCDate() - day + 3); // torsdag i samme uke
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return { year, week };
}

/** Mandag i en gitt ISO-uke. */
export function isoWeekMonday(year: number, week: number): string {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const mon = new Date(jan4);
  mon.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (week - 1) * 7);
  return mon.toISOString().slice(0, 10);
}

export function isoWeeksInYear(year: number): number {
  return isoWeek(`${year}-12-28`).week;
}
