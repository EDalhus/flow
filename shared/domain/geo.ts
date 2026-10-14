// Avstand og geofence. Haversine er mer enn nøyaktig nok på noen hundre meter.

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Avstand i meter mellom to punkter. */
export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function insideGeofence(p: { lat: number; lon: number }, fence: { lat: number; lon: number; radius_m: number }): boolean {
  return distanceM(p, fence) <= fence.radius_m;
}
