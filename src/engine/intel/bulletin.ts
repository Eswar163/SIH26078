// Teleprinter-style cyclone advisory, in the layout forecasters know from
// RSMC bulletins. Clearly marked as a synthetic training product.

import { catName, catIndex, KT_TO_KMH } from '../imd';
import type { EventTrack } from '../events';
import type { Cone } from '../cone';
import { compassWords } from '../geo';
import { referenceCities, relativeTo, seaArea } from '../places';
import { dateAt } from './phrases';

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

function utc(analysis: number, t: number): { hhmm: string; long: string; short: string } {
  const d = dateAt(analysis, t, 'UTC');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  return {
    hhmm: `${hh}00 UTC`,
    long: `${hh}00 UTC OF ${dd} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
    short: `${dd}.${mm}/${hh}00`,
  };
}

function windKmh(kt: number): string {
  const v = kt * KT_TO_KMH;
  const lo = Math.max(20, Math.floor(v / 10) * 10);
  const g = Math.max(lo + 15, Math.round((v * 1.18) / 5) * 5);
  return `${lo}-${lo + 10} G ${g}`;
}

export function bulletinFor(ev: EventTrack, analysis: number, cone: Cone | undefined, advisoryNo = 1): string {
  const lines: string[] = [];
  const i = Math.max(0, ev.points.findIndex((p) => p.t >= 0));
  const p = ev.points[i];
  const name = ev.name ? ` "${ev.name.toUpperCase()}"` : '';
  const cat = catName(p.cat).toUpperCase();
  const issue = utc(analysis, 3);
  lines.push('SYNTHETIC TRAINING RUN. NOT AN OFFICIAL IMD PRODUCT.');
  lines.push(`TRIKAAL CYCLONE ADVISORY NO. ${String(advisoryNo).padStart(2, '0')} FOR ${ev.label}${name}`);
  lines.push(`ISSUED AT ${issue.long} BASED ON ${utc(analysis, 0).hhmm} ANALYSIS`);
  lines.push('');
  const sea = p.overLand ? 'LAND' : seaArea(p.lon, p.lat).toUpperCase().replace(/^THE /, '');
  lines.push(`SUB: ${cat}${name} OVER ${sea}`);
  lines.push('');
  const refs = referenceCities(p.lon, p.lat, !p.overLand, 2).map((c) => relativeTo(p.lon, p.lat, c).toUpperCase());
  const motion = ev.speed[i] < 4 ? 'REMAINED NEARLY STATIONARY' : `MOVED ${compassWords(ev.heading[i]).toUpperCase().replace(/ /g, '-')}WARDS WITH A SPEED OF ${Math.round(ev.speed[i])} KMPH`;
  lines.push(
    wrap(
      `THE ${cat}${name} OVER ${sea} ${motion} DURING THE PAST 6 HOURS AND LAY CENTRED AT ${utc(analysis, p.t).long} NEAR LATITUDE ${p.lat.toFixed(1)}N AND LONGITUDE ${p.lon.toFixed(1)}E, ${refs.join(' AND ')}.`,
    ),
  );
  lines.push('');
  const peak = ev.points[ev.peakIndex];
  const parts: string[] = [];
  const an = (w: string) => (/^[AEIOU]/.test(w) ? 'AN' : 'A');
  if (ev.peakIndex > i && catIndex(peak.cat) > catIndex(p.cat)) parts.push(`INTENSIFY INTO ${an(catName(peak.cat).toUpperCase())} ${catName(peak.cat).toUpperCase()} BY ${utc(analysis, peak.t).long}`);
  if (ev.landfall && ev.landfall.t > 0) {
    parts.push(
      `CROSS THE ${ev.landfall.region.toUpperCase()} COAST NEAR ${ev.landfall.place.toUpperCase()} AROUND ${utc(analysis, Math.round(ev.landfall.t)).long} AS ${an(catName(ev.landfall.cat).toUpperCase())} ${catName(ev.landfall.cat).toUpperCase()} WITH MAXIMUM SUSTAINED WIND SPEED OF ${windKmh(ev.landfall.vmax).replace(' G ', ' KMPH GUSTING TO ')} KMPH`,
    );
  }
  if (parts.length) lines.push(wrap(`IT IS VERY LIKELY TO ${parts.join(' AND ')}.`));
  lines.push('');
  lines.push('FORECAST TRACK AND INTENSITY:');
  lines.push('DATE/TIME (UTC)  LAT.N  LONG.E  MAX WIND (KMPH)   CATEGORY');
  for (const q of ev.points.filter((x) => x.t >= 0 && x.t <= 120 && (x.t % 12 === 0 || x.t <= 24))) {
    const row = `${utc(analysis, q.t).short.padEnd(17)}${q.lat.toFixed(1).padEnd(7)}${q.lon.toFixed(1).padEnd(8)}${windKmh(q.vmax ?? 0).padEnd(18)}${q.cat}`;
    lines.push(row);
  }
  if (cone) {
    lines.push('');
    lines.push(`ENSEMBLE GUIDANCE (${cone.members} MATCHED MEMBERS):`);
    if (cone.landfall.members > 0) {
      lines.push(wrap(`${Math.round(cone.landfall.probability * 100)} PERCENT OF MEMBERS MAKE LANDFALL.${cone.landfall.likely ? ` HALF OF THEM BETWEEN ${cone.landfall.likely.fromName.toUpperCase()} AND ${cone.landfall.likely.toName.toUpperCase()}.` : ''}`));
    } else lines.push('NO MEMBER MAKES LANDFALL WITHIN 7 DAYS.');
    lines.push(`TRACK CONFIDENCE: ${cone.confidence.toUpperCase()}.`);
  }
  lines.push('');
  lines.push('ADVICE: FISHERMEN ARE ADVISED NOT TO VENTURE INTO THE AFFECTED SEA AREAS. FOLLOW STATE DISASTER MANAGEMENT INSTRUCTIONS.');
  lines.push('NEXT ADVISORY AT ' + utc(analysis, 9).long + '.');
  return lines.join('\n');
}

function wrap(s: string, width = 78): string {
  const words = s.split(' ');
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) {
      out.push(line.trim());
      line = w;
    } else line += ' ' + w;
  }
  if (line.trim()) out.push(line.trim());
  return out.join('\n');
}
