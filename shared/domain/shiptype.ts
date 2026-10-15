// AIS skipstype (kode 0–99) til kort norsk tekst.
export function shipTypeLabel(code: number | null | undefined): string | null {
  if (code == null || code <= 0) return null;
  if (code === 30) return 'Fiskefartøy';
  if (code === 31 || code === 32) return 'Slep';
  if (code === 33) return 'Mudring/undervannsarbeid';
  if (code === 34) return 'Dykkeoperasjoner';
  if (code === 35) return 'Militært';
  if (code === 36) return 'Seilbåt';
  if (code === 37) return 'Fritidsbåt';
  if (code >= 40 && code < 50) return 'Hurtiggående fartøy';
  if (code === 50) return 'Losbåt';
  if (code === 51) return 'Redningsfartøy';
  if (code === 52) return 'Slepebåt';
  if (code === 53) return 'Havnefartøy';
  if (code === 55) return 'Politi';
  if (code >= 60 && code < 70) return 'Passasjerskip';
  if (code >= 70 && code < 80) return 'Lasteskip';
  if (code >= 80 && code < 90) return 'Tankskip';
  return 'Annet fartøy';
}
