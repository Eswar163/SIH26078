// AI Event Intelligence: the forecaster's briefing.
//
// Every sentence carries its evidence: the numbers and the source (model,
// ensemble, memory, RI model, cycle history) that justify it. Nothing is
// generated that cannot be traced back to computed data.

import type { Analog, AnalogGuidance } from '../analogs';
import type { Cone } from '../cone';
import type { CityOutlook, Decision } from '../decision';
import type { EventTrack } from '../events';
import { catIndex, catName, WARN_LEVELS } from '../imd';
import type { RiModel, RiPrediction } from '../ri';
import type { RunTrend } from '../runs';
import type { Relation } from '../track';
import type { SeasonId } from '../climate';
import { SEASONS } from '../climate';
import { coastRegionAt } from '../places';
import {
  areaPhrase,
  articleFor,
  capitalise,
  fmtDuration,
  fmtTime,
  joinList,
  kmh,
  lowerFirst,
  motionPhrase,
  partOfDay,
  pct,
  probWords,
  systemNoun,
  titleOf,
  whereIs,
  windRange,
  type TimeZone,
} from './phrases';

export type EvidenceSource = 'model' | 'ensemble' | 'memory' | 'ri' | 'cycles' | 'warnings';

export interface Evidence {
  label: string;
  value: string;
  source: EvidenceSource;
}

export interface Sentence {
  text: string;
  evidence: Evidence[];
}

export interface SystemBrief {
  eventId: string;
  title: string;
  kicker: string;
  sentences: Sentence[];
}

export interface Briefing {
  headline: string;
  issued: string;
  overview: Sentence[];
  systems: SystemBrief[];
  warnings: Sentence[];
  confidence: { level: 'high' | 'moderate' | 'low'; reasons: string[] };
  changes: Sentence[];
}

export interface IntelContext {
  season: SeasonId;
  analysis: number;
  tz: TimeZone;
  events: EventTrack[];
  relations: Relation[];
  cones: Record<string, Cone>;
  members: number | null;
  analogs: Record<string, { list: Analog[]; guidance: AnalogGuidance }>;
  novelty: Record<string, number>;
  ri: Record<string, RiPrediction | null>;
  riModel: RiModel | null;
  trends: Record<string, RunTrend>;
  outlooks: CityOutlook[];
  decisions: Decision[];
}

const S = (text: string, ...evidence: Evidence[]): Sentence => ({ text, evidence });
const E = (label: string, value: string, source: EvidenceSource): Evidence => ({ label, value, source });

/** The point of an event at the analysis time, or its first forecast point if it forms later. */
export function nowIndex(ev: EventTrack): number {
  const i = ev.points.findIndex((p) => p.t >= 0);
  if (i < 0) return ev.points.length - 1;
  if (ev.points[i].t === 0) return i;
  return ev.t0 > 0 ? 0 : Math.max(0, i - 1);
}

export function activeEvents(events: EventTrack[]): EventTrack[] {
  return events.filter((e) => e.t1 >= 0);
}

function importance(ev: EventTrack): number {
  const p = ev.points[ev.peakIndex];
  switch (ev.kind) {
    case 'cyclone':
      return 100 + catIndex(ev.maxCat) * 20 + (ev.landfall ? 15 : 0);
    case 'heat':
    case 'cold':
      return 60 + (p.severeFrac ?? 0) * 30;
    case 'wd':
      return 40 + (p.amp ?? 0) / 5;
    case 'rain':
      return 45 + (p.peak ?? 0) / 10;
    case 'storm':
      return 20 + (p.peak ?? 0) / 5;
  }
}

export function rankEvents(events: EventTrack[]): EventTrack[] {
  return activeEvents(events).sort((a, b) => importance(b) - importance(a));
}

export function buildBriefing(ctx: IntelContext): Briefing {
  const ranked = rankEvents(ctx.events);
  const cyclones = ranked.filter((e) => e.kind === 'cyclone' && catIndex(e.maxCat) >= 2);
  const lead = ranked[0];
  const issued = `Based on the ${fmtTime(ctx.analysis, 0, 'UTC')} analysis`;

  let headline = 'No significant weather systems in the next seven days';
  if (lead) headline = headlineFor(ctx, lead);

  const overview: Sentence[] = [];
  const season = SEASONS[ctx.season];
  const counts = new Map<string, number>();
  for (const e of ranked) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  const listParts: string[] = [];
  if (cyclones.length) listParts.push(`${cyclones.length} cyclonic system${cyclones.length > 1 ? 's' : ''} of depression strength or more`);
  const lows = ranked.filter((e) => e.kind === 'cyclone' && catIndex(e.maxCat) < 2).length;
  if (lows) listParts.push(`${lows} weaker low${lows > 1 ? 's' : ''}`);
  if (counts.get('wd')) listParts.push(`${counts.get('wd')} western disturbance${counts.get('wd')! > 1 ? 's' : ''}`);
  if (counts.get('heat')) listParts.push(`${counts.get('heat')} heat-wave area${counts.get('heat')! > 1 ? 's' : ''}`);
  if (counts.get('cold')) listParts.push(`${counts.get('cold')} cold-wave area${counts.get('cold')! > 1 ? 's' : ''}`);
  if (counts.get('rain')) listParts.push(`${counts.get('rain')} heavy-rain spell${counts.get('rain')! > 1 ? 's' : ''}`);
  overview.push(
    S(
      listParts.length
        ? `The ${season.label.toLowerCase()} run tracks ${joinList(listParts)} between now and ${fmtTime(ctx.analysis, 168, ctx.tz)}.`
        : `The ${season.label.toLowerCase()} run shows a quiet week.`,
      E('Events tracked', String(ranked.length), 'model'),
      E('Forecast window', '0 to 168 h', 'model'),
    ),
  );
  const red = ctx.outlooks.filter((o) => o.maxLevel === 3);
  const orange = ctx.outlooks.filter((o) => o.maxLevel === 2);
  if (red.length || orange.length) {
    const names = [...red, ...orange].slice(0, 4).map((o) => o.city.name);
    overview.push(
      S(
        `${red.length ? `${red.length} cit${red.length > 1 ? 'ies are' : 'y is'} under a red warning` : ''}${red.length && orange.length ? ' and ' : ''}${
          orange.length ? `${orange.length} under orange` : ''
        } during the next five days, led by ${joinList(names)}.`,
        E('Red', String(red.length), 'warnings'),
        E('Orange', String(orange.length), 'warnings'),
      ),
    );
  }

  const systems = ranked.slice(0, 6).map((ev) => systemBrief(ctx, ev));

  const warnings: Sentence[] = [];
  const actNow = ctx.decisions.filter((d) => d.status === 'act-now');
  const actBy = ctx.decisions.filter((d) => d.status === 'act-by');
  if (actNow.length) {
    const byAction = groupBy(actNow, (d) => d.action.label);
    for (const [label, ds] of byAction) {
      warnings.push(
        S(
          `${label} now: ${joinList(ds.slice(0, 5).map((d) => d.city.name))}${ds.length > 5 ? ` and ${ds.length - 5} more` : ''}.`,
          ...ds.slice(0, 3).map((d) => E(d.city.name, `${pct(d.p)} vs threshold ${pct(d.action.threshold)}`, 'warnings')),
        ),
      );
    }
  }
  if (actBy.length) {
    const first = actBy[0];
    warnings.push(
      S(
        `Next decision: ${lowerFirst(first.action.label)} in ${first.city.name} by ${fmtTime(ctx.analysis, first.lastMoment ?? 0, ctx.tz)}.`,
        E('Probability', pct(first.p), 'ensemble'),
        E('Lead time needed', `${first.action.lead} h`, 'warnings'),
      ),
    );
  }
  if (!warnings.length) warnings.push(S('No protective action is needed yet. Keep monitoring the next cycle.'));

  const confidence = overallConfidence(ctx, cyclones);
  const changes: Sentence[] = [];
  for (const ev of cyclones) {
    const tr = ctx.trends[ev.id];
    if (!tr || tr.verdict === 'n/a') continue;
    changes.push(S(`${titleOf(ev)}: ${tr.note}`, E('Cycles compared', String(tr.runs.length), 'cycles')));
  }
  if (!changes.length) changes.push(S('Earlier cycles are still loading or show no significant change.'));
  return { headline, issued, overview, systems, warnings, confidence, changes };
}

function headlineFor(ctx: IntelContext, ev: EventTrack): string {
  const i = nowIndex(ev);
  const p = ev.points[i];
  const peak = ev.points[ev.peakIndex];
  if (ev.kind === 'cyclone') {
    const name = ev.name ? `Cyclone ${ev.name}` : `${catName(p.cat)} ${ev.label}`;
    if (ev.landfall && ev.landfall.t > 0) {
      return `${name} to cross the ${ev.landfall.region} coast near ${ev.landfall.place} as ${articleFor(catName(ev.landfall.cat))} ${catName(ev.landfall.cat).toLowerCase()} around ${fmtTime(ctx.analysis, Math.round(ev.landfall.t), ctx.tz)}`;
    }
    if (catIndex(peak.cat) > catIndex(p.cat)) return `${name} expected to strengthen into ${articleFor(catName(peak.cat))} ${catName(peak.cat).toLowerCase()}`;
    return `${name} ${whereIs(p).split(',')[0]}`;
  }
  if (ev.kind === 'heat') return `${capitalise(systemNoun(ev, peak))} over ${whereIs(peak).replace(/^over /, '').split(',')[0]}, peaking near ${Math.round(peak.peak ?? 0)} °C`;
  if (ev.kind === 'cold') return `${capitalise(systemNoun(ev, peak))} over ${whereIs(peak).replace(/^over /, '').split(',')[0]}`;
  if (ev.kind === 'wd') return `${capitalise(systemNoun(ev, peak))} brings rain and snow to the western Himalaya`;
  return `${capitalise(systemNoun(ev, peak))} ${whereIs(peak).split(',')[0]}`;
}

function systemBrief(ctx: IntelContext, ev: EventTrack): SystemBrief {
  const i = nowIndex(ev);
  const p = ev.points[i];
  const out: Sentence[] = [];
  const future = ev.t0 > 0;
  if (ev.kind === 'cyclone') {
    const noun = catName(p.cat).toLowerCase();
    if (future) {
      out.push(
        S(
          `A ${noun} is forecast to form ${whereIs(p)} around ${fmtTime(ctx.analysis, ev.t0, ctx.tz)}.`,
          E('Genesis', fmtTime(ctx.analysis, ev.t0, ctx.tz), 'model'),
          E('Position', `${p.lat.toFixed(1)}°N ${p.lon.toFixed(1)}°E`, 'model'),
        ),
      );
    } else {
      out.push(
        S(
          `The ${noun} lies ${whereIs(p)}, ${motionPhrase(ev, i)}.`,
          E('Centre', `${p.lat.toFixed(1)}°N ${p.lon.toFixed(1)}°E`, 'model'),
          E('Max wind', `${Math.round(p.vmax ?? 0)} kt (${kmh(p.vmax ?? 0)} km/h)`, 'model'),
          E('Central pressure', `${Math.round(p.pmin ?? 0)} hPa`, 'model'),
          E('Closed isobars', String(p.closed ?? 0), 'model'),
        ),
      );
    }
    const peak = ev.points[ev.peakIndex];
    if (ev.peakIndex > i && catIndex(peak.cat) > catIndex(p.cat)) {
      const cone = ctx.cones[ev.id];
      const e = cone?.ellipses.find((x) => x.t === peak.t);
      const pAbove = cone ? memberShare(cone, peak.t, (v) => v >= peakFloor(peak.cat), ctx.members) : null;
      const target = `${articleFor(catName(peak.cat))} ${catName(peak.cat).toLowerCase()} by ${fmtTime(ctx.analysis, peak.t, ctx.tz)}`;
      out.push(
        S(
          pAbove === null || pAbove >= 0.4
            ? `It ${pAbove !== null ? probWords(pAbove) : 'is likely to'} intensify into ${target}, with maximum sustained winds of ${windRange(peak.vmax ?? 0)}.`
            : `The model intensifies it into ${target} (${windRange(peak.vmax ?? 0)}), but only ${pct(pAbove)} of ensemble members reach that strength.`,
          E('Model peak', `${Math.round(peak.vmax ?? 0)} kt at ${fmtTime(ctx.analysis, peak.t, ctx.tz)}`, 'model'),
          ...(e ? [E('Ensemble range', `${Math.round(e.vmax.p10)}–${Math.round(e.vmax.p90)} kt (10–90%)`, 'ensemble')] : []),
          ...(pAbove !== null ? [E('Members at that strength', pct(pAbove), 'ensemble')] : []),
        ),
      );
    }
    const ri = ctx.ri[ev.id];
    if (ri && ctx.riModel && ri.probability >= Math.max(0.2, ctx.riModel.climatology * 2)) {
      const top = ri.contributions.filter((c) => c.effect > 0).slice(0, 2).map((c) => c.feature.toLowerCase());
      out.push(
        S(
          `Rapid intensification is a real risk: ${pct(ri.probability)} chance of a 30 kt jump in 24 h, about ${Math.round(ri.probability / Math.max(0.01, ctx.riModel.climatology))} times the usual rate${top.length ? `, driven by ${joinList(top)}` : ''}.`,
          E('RI probability', pct(ri.probability), 'ri'),
          E('Climatology', pct(ctx.riModel.climatology), 'ri'),
          E('Model skill (AUC)', ctx.riModel.auc.toFixed(2), 'ri'),
        ),
      );
    }
    const cone = ctx.cones[ev.id];
    if (ev.landfall && ev.landfall.t > 0) {
      const lf = ev.landfall;
      const ev2: Evidence[] = [
        E('Model landfall', `${lf.place}, ${fmtTime(ctx.analysis, Math.round(lf.t), ctx.tz)}`, 'model'),
        E('Wind at landfall', `${Math.round(lf.vmax)} kt`, 'model'),
      ];
      let text = `The model brings it ashore near ${lf.place} on the ${lf.region} coast during the ${partOfDay(ctx.analysis, lf.t)} as ${articleFor(catName(lf.cat))} ${catName(lf.cat).toLowerCase()} (${windRange(lf.vmax)}).`;
      if (cone?.landfall.likely) {
        const L = cone.landfall;
        ev2.push(E('Ensemble landfall chance', pct(L.probability), 'ensemble'));
        ev2.push(E('Most likely stretch', `${L.likely!.fromName} to ${L.likely!.toName}`, 'ensemble'));
        if (L.time) ev2.push(E('Timing (10–90%)', `${fmtTime(ctx.analysis, Math.round(L.time.p10), ctx.tz)} to ${fmtTime(ctx.analysis, Math.round(L.time.p90), ctx.tz)}`, 'ensemble'));
        text += ` Half of the ensemble crosses between ${L.likely!.fromName} and ${L.likely!.toName}; ${pct(L.probability)} of members make landfall within the week.`;
      }
      out.push(S(text, ...ev2));
    } else if (cone && cone.landfall.probability >= 0.25 && !(ev.landfall && ev.landfall.t <= 0)) {
      const L = cone.landfall;
      const region = L.byRegion[0]?.region;
      out.push(
        S(
          `The deterministic run keeps it at sea, but ${pct(L.probability)} of ensemble members bring it ashore${region ? `, mostly over ${region}` : ''}.`,
          E('Ensemble landfall chance', pct(L.probability), 'ensemble'),
        ),
      );
    }
    if (cone) {
      const words = cone.confidence === 'high' ? 'tightly clustered' : cone.confidence === 'moderate' ? 'moderately spread' : 'widely spread';
      out.push(
        S(
          `Track confidence is ${cone.confidence}: the ${cone.members} matched members are ${words}${cone.spread72 !== null ? ` (${Math.round(cone.spread72)} km mean spread at ${cone.spreadLead} h)` : ''}.`,
          E('Members matched', `${cone.members}/${ctx.members ?? '?'}`, 'ensemble'),
          ...(cone.spread72 !== null ? [E(`Spread at ${cone.spreadLead} h`, `${Math.round(cone.spread72)} km`, 'ensemble')] : []),
        ),
      );
    }
    const an = ctx.analogs[ev.id];
    if (an && an.list.length) {
      const top = an.list[0];
      out.push(
        S(
          `Closest relative in memory: ${top.event.name ? `${top.event.name} (${top.event.label})` : top.event.label}, ${pct(top.similarity)} similar. ${an.guidance.note} ${pct(an.guidance.landfallP)} of the ${an.list.length} closest relatives made landfall${an.guidance.regions[0] ? `, most often over ${an.guidance.regions[0].region}` : ''}.`,
          E('Top analog', `${top.event.label} (${pct(top.similarity)})`, 'memory'),
          E('Relatives median peak', an.guidance.medianPeakCat, 'memory'),
          E('Relatives making landfall', pct(an.guidance.landfallP), 'memory'),
        ),
      );
      const nov = ctx.novelty[ev.id];
      if (nov !== undefined && nov > 0.6) {
        out.push(S(`This system has few close relatives in the archive (novelty ${nov.toFixed(2)}), so lean on the ensemble rather than on analogs.`, E('Novelty', nov.toFixed(2), 'memory')));
      }
    }
    const lineage = ctx.relations.filter((r) => r.to === ev.id && r.type !== 'rainband');
    for (const r of lineage) {
      const parent = ctx.events.find((e) => e.id === r.from);
      if (!parent) continue;
      out.push(
        S(
          r.type === 'regenerated'
            ? `It is the regenerated remnant of ${titleOf(parent)}, which weakened over land before re-emerging over the sea.`
            : r.type === 'split'
              ? `It split from ${titleOf(parent)} at ${fmtTime(ctx.analysis, r.t, ctx.tz)}.`
              : r.type === 'induced'
                ? `It was induced by ${titleOf(parent)} to its north.`
                : `It merged with ${titleOf(parent)}.`,
          E('Lineage', `${parent.label} → ${ev.label}`, 'model'),
        ),
      );
    }
  } else if (ev.kind === 'heat' || ev.kind === 'cold') {
    const peak = ev.points[ev.peakIndex];
    out.push(
      S(
        `${capitalise(systemNoun(ev, peak))} conditions ${future ? 'are forecast to develop' : 'prevail'} ${areaPhrase(peak)}, covering about ${Math.round((peak.area ?? 0) / 1000) * 1000 > 0 ? (Math.round((peak.area ?? 0) / 10000) * 10000).toLocaleString('en-IN') : 'a small area of'} km².`,
        E(ev.kind === 'heat' ? 'Peak maximum' : 'Lowest minimum', `${(peak.peak ?? 0).toFixed(1)} °C`, 'model'),
        E('Departure from normal', `${(peak.mean ?? 0) > 0 ? '+' : ''}${(peak.mean ?? 0).toFixed(1)} °C`, 'model'),
        E('Severe share', pct(peak.severeFrac ?? 0), 'model'),
      ),
    );
    out.push(S(`Expected to last until about ${fmtTime(ctx.analysis, ev.t1, ctx.tz)} (${fmtDuration(ev.t1 - Math.max(0, ev.t0))} from now).`, E('Last detected', fmtTime(ctx.analysis, ev.t1, ctx.tz), 'model')));
  } else if (ev.kind === 'wd') {
    const peak = ev.points[ev.peakIndex];
    out.push(
      S(
        `A ${systemNoun(ev, peak)} ${future ? 'will approach' : 'lies'} ${whereIs(p).replace(/, about.*/, '')}, ${motionPhrase(ev, i)}, as a 500 hPa trough of ${Math.round(peak.amp ?? 0)} gpm.`,
        E('Trough amplitude', `${Math.round(peak.amp ?? 0)} gpm`, 'model'),
        E('Peak precipitation', `${Math.round(peak.rainMax ?? 0)} mm in 6 h`, 'model'),
      ),
    );
    const induced = ctx.relations.filter((r) => r.from === ev.id && r.type === 'induced');
    if (induced.length) out.push(S(`It induces ${induced.length} secondary system${induced.length > 1 ? 's' : ''} to its south.`, E('Induced', induced.map((r) => r.to).join(', '), 'model')));
  } else {
    const peak = ev.points[ev.peakIndex];
    out.push(
      S(
        `${capitalise(systemNoun(ev, peak))} ${areaPhrase(peak)}, peaking at ${Math.round(peak.peak ?? 0)} mm ${ev.kind === 'rain' ? 'in 24 h' : 'in 6 h'} around ${fmtTime(ctx.analysis, peak.t, ctx.tz)}.`,
        E('Peak', `${Math.round(peak.peak ?? 0)} mm`, 'model'),
        E('Area', `${Math.round((peak.area ?? 0) / 1000).toLocaleString('en-IN')} thousand km²`, 'model'),
      ),
    );
    const parent = ctx.relations.find((r) => r.to === ev.id && r.type === 'rainband');
    const pe = parent && ctx.events.find((e) => e.id === parent.from);
    if (pe) out.push(S(`It is part of the rain shield of ${titleOf(pe)}.`, E('Parent', pe.label, 'model')));
  }
  const p0 = ev.kind === 'cyclone' || ev.kind === 'wd' ? ev.points[i] : ev.points[ev.peakIndex];
  return { eventId: ev.id, title: titleOf(ev), kicker: capitalise(systemNoun(ev, p0)), sentences: out };
}

function peakFloor(cat: string): number {
  const floors: Record<string, number> = { D: 17, DD: 28, CS: 34, SCS: 48, VSCS: 64, ESCS: 90, SuCS: 120 };
  return floors[cat] ?? 0;
}

function memberShare(cone: Cone, t: number, pred: (v: number) => boolean, members: number | null): number | null {
  const e = cone.ellipses.find((x) => x.t === t);
  if (!e) return null;
  return e.vs.filter(pred).length / Math.max(1, members ?? e.vs.length);
}

function overallConfidence(ctx: IntelContext, cyclones: EventTrack[]): Briefing['confidence'] {
  const reasons: string[] = [];
  let score = 0;
  let n = 0;
  for (const ev of cyclones) {
    const c = ctx.cones[ev.id];
    if (c) {
      n++;
      score += c.confidence === 'high' ? 2 : c.confidence === 'moderate' ? 1 : 0;
      reasons.push(`${titleOf(ev)}: ${c.confidence} track confidence${c.spread72 !== null ? ` (${Math.round(c.spread72)} km spread at ${c.spreadLead} h)` : ''}.`);
    }
    const tr = ctx.trends[ev.id];
    if (tr?.verdict === 'flip-flopping') {
      score -= 1;
      reasons.push(`${titleOf(ev)}: landfall has swung between cycles.`);
    }
    const an = ctx.analogs[ev.id];
    if (an?.guidance.agreement === 'disagree') reasons.push(`${titleOf(ev)}: analogs disagree with the model on peak strength.`);
    if (an?.guidance.agreement === 'agree') {
      score += 0.5;
      reasons.push(`${titleOf(ev)}: analogs agree with the model.`);
    }
  }
  if (!n) reasons.push('No ensemble-tracked cyclone; confidence reflects the deterministic run only.');
  const avg = n ? score / n : 1;
  const level = avg >= 1.6 ? 'high' : avg >= 0.8 ? 'moderate' : 'low';
  return { level, reasons };
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return m;
}

export function warnName(level: number): string {
  return WARN_LEVELS[level]?.name ?? 'Green';
}

export { coastRegionAt };
