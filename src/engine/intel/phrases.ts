// Wording helpers shared by the briefing, the bulletin and the Q&A engine.
// Phrasing follows the conventions of Indian forecast bulletins.

import { compassWords } from '../geo';
import { catName, KT_TO_KMH } from '../imd';
import { referenceCities, relativeTo, seaArea, nearestCity } from '../places';
import type { EventTrack } from '../events';
import type { TrackPoint } from '../track';

export type TimeZone = 'UTC' | 'IST';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function dateAt(analysis: number, t: number, tz: TimeZone): Date {
  return new Date(analysis + t * 3600_000 + (tz === 'IST' ? 5.5 * 3600_000 : 0));
}

/** "06 Oct 00 UTC" or "06 Oct 05:30 IST". */
export function fmtTime(analysis: number, t: number, tz: TimeZone): string {
  const d = dateAt(analysis, t, tz);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = d.getUTCMinutes();
  const time = tz === 'IST' ? `${hh}:${String(mm).padStart(2, '0')} IST` : `${hh} UTC`;
  return `${dd} ${MONTHS[d.getUTCMonth()]} ${time}`;
}

/** "Mon 06 Oct" */
export function fmtDay(analysis: number, t: number, tz: TimeZone): string {
  const d = dateAt(analysis, t, tz);
  return `${DAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]}`;
}

/** Part of day in local time, the way bulletins talk: "early morning of 6 October". */
export function partOfDay(analysis: number, t: number): string {
  const d = dateAt(analysis, t, 'IST');
  const h = d.getUTCHours();
  const when = h < 4 ? 'midnight' : h < 8 ? 'early morning' : h < 12 ? 'forenoon' : h < 16 ? 'afternoon' : h < 20 ? 'evening' : 'night';
  return `${when} of ${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]}`;
}

export function fmtLead(t: number): string {
  if (t === 0) return 'analysis';
  const sign = t > 0 ? '+' : '−';
  return `${sign}${Math.abs(t)} h`;
}

export function fmtDuration(h: number): string {
  if (h < 24) return `${Math.round(h)} h`;
  const d = Math.floor(h / 24);
  const r = Math.round(h - d * 24);
  return r ? `${d} d ${r} h` : `${d} d`;
}

export function windRange(kt: number): string {
  const kmh = kt * KT_TO_KMH;
  const lo = Math.max(10, Math.floor(kmh / 10) * 10);
  const gust = Math.round((kmh * 1.18) / 5) * 5;
  return `${lo}–${lo + 10} km/h gusting to ${Math.max(lo + 15, gust)} km/h`;
}

export function kmh(kt: number): number {
  return Math.round((kt * KT_TO_KMH) / 5) * 5;
}

export function probWords(p: number): string {
  if (p >= 0.9) return 'very likely';
  if (p >= 0.66) return 'likely';
  if (p >= 0.4) return 'may';
  if (p >= 0.15) return 'has a small chance to';
  return 'is unlikely to';
}

export function pct(p: number): string {
  if (p > 0 && p < 0.05) return '<5%';
  return `${Math.round(p * 100)}%`;
}

/** "over the southwest Bay of Bengal, about 230 km east-southeast of Puducherry and 340 km southeast of Chennai" */
export function whereIs(p: Pick<TrackPoint, 'lon' | 'lat' | 'overLand'>): string {
  if (p.overLand) {
    const n = nearestCity(p.lon, p.lat, (c) => c.country === 'India' || c.tier === 1);
    return `over ${n.city.country === 'India' ? n.city.state : n.city.country}, ${relativeTo(p.lon, p.lat, n.city)}`;
  }
  const refs = referenceCities(p.lon, p.lat, true, 2);
  const parts = refs.map((c) => relativeTo(p.lon, p.lat, c));
  return `over ${seaArea(p.lon, p.lat)}, ${parts.join(' and ')}`;
}

/** "over Tamil Nadu around Cuddalore" for land, "over the southwest Bay of Bengal" at sea. */
export function areaPhrase(p: Pick<TrackPoint, 'lon' | 'lat' | 'overLand'>): string {
  if (!p.overLand) return `over ${seaArea(p.lon, p.lat)}`;
  const n = nearestCity(p.lon, p.lat, (c) => c.country === 'India' || c.tier === 1);
  const region = n.city.country === 'India' ? n.city.state : n.city.country;
  return region === n.city.name ? `around ${n.city.name}` : `over ${region} around ${n.city.name}`;
}

export function shortWhere(p: Pick<TrackPoint, 'lon' | 'lat' | 'overLand'>): string {
  if (p.overLand) {
    const n = nearestCity(p.lon, p.lat, (c) => c.country === 'India' || c.tier === 1);
    return n.km < 60 ? `near ${n.city.name}` : relativeTo(p.lon, p.lat, n.city);
  }
  const ref = referenceCities(p.lon, p.lat, true, 1)[0];
  return relativeTo(p.lon, p.lat, ref);
}

export function motionPhrase(ev: EventTrack, i: number): string {
  const s = ev.speed[i];
  if (s < 4) return 'nearly stationary';
  return `moving ${compassWords(ev.heading[i]).replace(/ /g, '-')}wards at ${Math.round(s)} km/h`;
}

export function systemNoun(ev: EventTrack, p: TrackPoint): string {
  switch (ev.kind) {
    case 'cyclone':
      return catName(p.cat).toLowerCase();
    case 'wd':
      return `${p.cat.toLowerCase()} western disturbance`;
    case 'rain':
      return `${p.cat} rain spell`;
    case 'heat':
      return p.cat === 'SHW' ? 'severe heat wave' : 'heat wave';
    case 'cold':
      return p.cat === 'SCW' ? 'severe cold wave' : 'cold wave';
    case 'storm':
      return p.cat === 'STS' ? 'severe thunderstorm cluster' : 'thunderstorm cluster';
  }
}

export function titleOf(ev: EventTrack): string {
  if (ev.kind === 'cyclone') return ev.name ? `${ev.name} (${ev.label})` : ev.label;
  return ev.label;
}

/** Lower-case the first letter only, so acronyms such as NDRF survive. */
export function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function articleFor(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
