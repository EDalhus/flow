// Produksjon: beregnet silonivå per pakkelinje (MVP). Når sensorer kobles på, erstattes
// «level» med målt verdi, og resten av rådene kan beholdes.
//
//   pakket   = min(ordre, hastighet × tid siden start)
//   fylt     = påfyllinger registrert på aktiv ordre
//   nivå     = maks(0, fylt − pakket), begrenset av silostørrelsen
//   gjenstår = ordre − pakket
// Rådet til hjullasteren: fyll opp til silostørrelsen, men aldri mer enn det som trengs for å
// fullføre ordren – da slipper man rester når linjen bytter kvalitet.

export interface SiloInput {
  capacity: number;
  rateTph: number;
  order: { tonnes: number; started_at: string | null } | null;
  filledForOrder: number;
}

export interface SiloState {
  level: number;
  packed: number;
  remaining: number;
  /** Hvor mye som bør fylles nå (0 = ikke fyll). */
  fillNow: number;
  /** Nok i siloen til å fullføre ordren – ikke fyll mer før kvalitetsbytte. */
  enoughForOrder: boolean;
  /** Minutter til siloen er tom med nåværende hastighet. */
  minutesToEmpty: number | null;
  /** Når ordren er ferdig pakket (ISO), hvis den pågår. */
  finishAt: string | null;
  advice: 'fyll' | 'snart' | 'ok' | 'stopp' | 'ingen';
}

export function siloState(i: SiloInput, now: number): SiloState {
  if (!i.order) {
    return { level: 0, packed: 0, remaining: 0, fillNow: 0, enoughForOrder: false, minutesToEmpty: null, finishAt: null, advice: 'ingen' };
  }
  const hours = i.order.started_at ? Math.max(0, (now - Date.parse(i.order.started_at)) / 3_600_000) : 0;
  const packed = Math.min(i.order.tonnes, i.rateTph * hours, i.filledForOrder);
  const remaining = Math.max(0, i.order.tonnes - packed);
  const level = Math.min(i.capacity, Math.max(0, i.filledForOrder - packed));
  const enoughForOrder = i.filledForOrder >= i.order.tonnes - 0.05;
  const target = Math.min(i.capacity, remaining);
  const fillNow = enoughForOrder ? 0 : Math.max(0, Math.round((target - level) * 10) / 10);
  const minutesToEmpty = i.order.started_at && level > 0 ? Math.round((level / i.rateTph) * 60) : level > 0 ? null : 0;
  const finishAt = i.order.started_at ? new Date(Date.parse(i.order.started_at) + (i.order.tonnes / i.rateTph) * 3_600_000).toISOString() : null;
  let advice: SiloState['advice'] = 'ok';
  if (enoughForOrder) advice = 'stopp';
  else if (level <= i.capacity * 0.25) advice = 'fyll';
  else if (level <= i.capacity * 0.5) advice = 'snart';
  return { level, packed, remaining, fillNow, enoughForOrder, minutesToEmpty, finishAt, advice };
}
