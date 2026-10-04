// Spherical helpers. Distances in km, bearings in degrees clockwise from north.

export const R_EARTH = 6371;
export const KM_PER_DEG = (Math.PI * R_EARTH) / 180; // 111.19 km
const RAD = Math.PI / 180;

export function distKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const dp = p2 - p1;
  const dl = (lon2 - lon1) * RAD;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Fast flat-earth distance; accurate to <1% within ~1500 km in the tropics. */
export function fastDistKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const c = Math.cos(((lat1 + lat2) / 2) * RAD);
  const dx = (lon2 - lon1) * c;
  const dy = lat2 - lat1;
  return Math.sqrt(dx * dx + dy * dy) * KM_PER_DEG;
}

export function bearingDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const dl = (lon2 - lon1) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

export function destination(lon: number, lat: number, bearing: number, km: number): [number, number] {
  const d = km / R_EARTH;
  const b = bearing * RAD;
  const p1 = lat * RAD;
  const l1 = lon * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [l2 / RAD, p2 / RAD];
}

/** Local tangent-plane coordinates (km east, km north) of a point relative to an origin. */
export function toLocal(lon0: number, lat0: number, lon: number, lat: number): [number, number] {
  return [(lon - lon0) * Math.cos(lat0 * RAD) * KM_PER_DEG, (lat - lat0) * KM_PER_DEG];
}

export function fromLocal(lon0: number, lat0: number, x: number, y: number): [number, number] {
  return [lon0 + x / (Math.cos(lat0 * RAD) * KM_PER_DEG), lat0 + y / KM_PER_DEG];
}

/** Move a point by a velocity (m/s) for `hours`. */
export function advect(lon: number, lat: number, u: number, v: number, hours: number): [number, number] {
  const dx = (u * 3.6 * hours) / KM_PER_DEG; // km -> deg
  const dy = (v * 3.6 * hours) / KM_PER_DEG;
  return [lon + dx / Math.cos(lat * RAD), lat + dy];
}

const COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const COMPASS_WORDS = [
  'north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast',
  'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest',
];

export function compass16(bearing: number): string {
  return COMPASS16[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16];
}

export function compassWords(bearing: number): string {
  return COMPASS_WORDS[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16];
}

/** Smallest signed difference b - a between two headings, in (-180, 180]. */
export function headingDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export function formatLatLon(lon: number, lat: number, digits = 1): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(digits)}°${ns} ${Math.abs(lon).toFixed(digits)}°${ew}`;
}

/** Distance (km) from a point to a polyline given as [lon, lat] pairs, and the arc position of the nearest point. */
export function nearestOnPolyline(
  lon: number,
  lat: number,
  line: readonly (readonly [number, number])[],
): { dist: number; arcKm: number; index: number; t: number } {
  let best = { dist: Infinity, arcKm: 0, index: 0, t: 0 };
  let arc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = toLocal(lon, lat, line[i][0], line[i][1]);
    const [bx, by] = toLocal(lon, lat, line[i + 1][0], line[i + 1][1]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = Math.sqrt(px * px + py * py);
    const segLen = Math.sqrt(len2);
    if (d < best.dist) best = { dist: d, arcKm: arc + t * segLen, index: i, t };
    arc += segLen;
  }
  return best;
}
