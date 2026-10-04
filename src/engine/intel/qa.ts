// Ask-the-run: a deterministic question-answering engine over the computed
// run. It recognises what is being asked about (a system, a city, a hazard)
// and what kind of answer is wanted, then answers from the data with its
// evidence attached. No text is invented: unknown questions get suggestions.

import { catIndex, catName, WARN_LEVELS } from '../imd';
import { CITIES, type City } from '../places';
import type { EventTrack } from '../events';
import { buildBriefing, nowIndex, rankEvents, type Evidence, type IntelContext } from './briefing';
import { fmtTime, joinList, kmh, lowerFirst, motionPhrase, pct, titleOf, whereIs, windRange } from './phrases';

export interface Answer {
  text: string;
  evidence: Evidence[];
  focus?: { eventId?: string; cityId?: string; t?: number };
  suggestions?: string[];
}

const ALIASES: Record<string, string> = {
  vizag: 'visakhapatnam',
  vishakhapatnam: 'visakhapatnam',
  bombay: 'mumbai',
  madras: 'chennai',
  calcutta: 'kolkata',
  bangalore: 'bengaluru',
  trivandrum: 'thiruvananthapuram',
  cochin: 'kochi',
  mangalore: 'mangaluru',
  pondicherry: 'puducherry',
  pondy: 'puducherry',
  bhubaneshwar: 'bhubaneswar',
  berhampur: 'brahmapur',
  gopalpur: 'brahmapur',
  goa: 'panaji',
  allahabad: 'prayagraj',
  tuticorin: 'thoothukudi',
  calicut: 'kozhikode',
  baroda: 'vadodara',
  chittagong: 'chattogram',
};

function findCity(q: string): City | null {
  for (const [alias, id] of Object.entries(ALIASES)) if (new RegExp(`\\b${alias}\\b`).test(q)) return CITIES.find((c) => c.name.toLowerCase() === id) ?? null;
  const sorted = [...CITIES].sort((a, b) => b.name.length - a.name.length);
  for (const c of sorted) if (q.includes(c.name.toLowerCase())) return c;
  return null;
}

function findEvent(q: string, ctx: IntelContext): EventTrack | null {
  const active = rankEvents(ctx.events);
  for (const e of ctx.events) {
    if (e.name && q.includes(e.name.toLowerCase())) return e;
    if (e.pendingName && q.includes(e.pendingName.toLowerCase())) return e;
    if (q.includes(e.label.toLowerCase())) return e;
  }
  const kindWords: [RegExp, EventTrack['kind']][] = [
    [/cyclone|storm|depression|\blow\b|system|it\b/, 'cyclone'],
    [/western disturbance|\bwd\b|snow/, 'wd'],
    [/heat|hot|temperature/, 'heat'],
    [/cold|chill|frost/, 'cold'],
    [/thunder|lightning|hail/, 'storm'],
    [/rain|flood|downpour/, 'rain'],
  ];
  for (const [re, kind] of kindWords) {
    if (re.test(q)) {
      const e = active.find((x) => x.kind === kind);
      if (e) return e;
    }
  }
  return active[0] ?? null;
}

const SUGGESTIONS = [
  'Where will the cyclone make landfall?',
  'Is Chennai at risk?',
  'How strong will it get?',
  'What changed since the last run?',
  'Which cities need a red warning?',
  'Has anything like this happened before?',
  'How confident is the forecast?',
];

export function answer(question: string, ctx: IntelContext): Answer {
  const q = question.toLowerCase().replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return { text: 'Ask about a system, a city or a hazard.', evidence: [], suggestions: SUGGESTIONS };
  const city = findCity(q);
  const ev = findEvent(q, ctx);
  const has = (re: RegExp) => re.test(q);

  if (has(/summary|overview|what.?s happening|which systems|list|brief/)) {
    const b = buildBriefing(ctx);
    return { text: `${b.headline}. ${b.overview.map((s) => s.text).join(' ')}`, evidence: b.overview.flatMap((s) => s.evidence) };
  }
  if (has(/warning|alert|\bred\b|orange|district|evacuat|action|what should|prepare/)) return warningsAnswer(ctx, city);
  if (city && (has(/risk|safe|affect|hit|threat|impact|danger|wind|reach|when|arrive/) || !ev)) return cityAnswer(ctx, city);
  if (!ev) return { text: 'No active system matches that question.', evidence: [], suggestions: SUGGESTIONS };
  if (has(/change|previous|last run|earlier|trend|shift|cycle/)) return trendAnswer(ctx, ev);
  if (has(/similar|analog|\blike\b|past|history|before|relative/)) return analogAnswer(ctx, ev);
  if (has(/confiden|uncertain|sure|spread|cone|probab/)) return confidenceAnswer(ctx, ev);
  if (has(/rapid|explosive|\bri\b|why.*(intens|strong)/)) return riAnswer(ctx, ev);
  if (has(/landfall|cross|coast|make land|where will|hit land/)) return landfallAnswer(ctx, ev);
  if (has(/strong|intens|peak|category|wind speed|weaken|strengthen|how bad/)) return intensityAnswer(ctx, ev);
  if (has(/where|location|position|now/)) return positionAnswer(ctx, ev);
  if (city) return cityAnswer(ctx, city);
  return { ...positionAnswer(ctx, ev), suggestions: SUGGESTIONS };
}

function positionAnswer(ctx: IntelContext, ev: EventTrack): Answer {
  const i = nowIndex(ev);
  const p = ev.points[i];
  const when = p.t === 0 ? 'At the analysis time' : `At ${fmtTime(ctx.analysis, p.t, ctx.tz)}`;
  return {
    text: `${when}, ${titleOf(ev)} is ${whereIs(p)}${ev.kind === 'cyclone' || ev.kind === 'wd' ? `, ${motionPhrase(ev, i)}` : ''}.`,
    evidence: [{ label: 'Centre', value: `${p.lat.toFixed(1)}°N ${p.lon.toFixed(1)}°E`, source: 'model' }],
    focus: { eventId: ev.id, t: p.t },
  };
}

function landfallAnswer(ctx: IntelContext, ev: EventTrack): Answer {
  if (ev.kind !== 'cyclone') return { text: `${titleOf(ev)} is not a cyclonic system, so landfall does not apply.`, evidence: [], focus: { eventId: ev.id } };
  const cone = ctx.cones[ev.id];
  const lf = ev.landfall;
  const ev2: Evidence[] = [];
  let text: string;
  if (lf && lf.t <= 0) {
    text = `${titleOf(ev)} has already crossed the coast near ${lf.place} at ${fmtTime(ctx.analysis, Math.round(lf.t), ctx.tz)}.`;
  } else if (lf) {
    text = `The model takes ${titleOf(ev)} ashore near ${lf.place} (${lf.region}) around ${fmtTime(ctx.analysis, Math.round(lf.t), ctx.tz)} as a ${catName(lf.cat).toLowerCase()}, ${windRange(lf.vmax)}.`;
    ev2.push({ label: 'Model landfall', value: `${lf.place}, ${fmtTime(ctx.analysis, Math.round(lf.t), ctx.tz)}`, source: 'model' });
  } else text = `The deterministic run does not bring ${titleOf(ev)} ashore within the forecast window.`;
  if (cone && cone.landfall.members > 0) {
    const L = cone.landfall;
    const regions = L.byRegion.slice(0, 3).map((r) => `${r.region} ${pct(r.p)}`);
    text += ` Across the ensemble, ${pct(L.probability)} of members make landfall: ${joinList(regions)}.`;
    if (L.likely) text += ` The most likely 50% stretch is ${L.likely.fromName} to ${L.likely.toName}.`;
    if (L.time) text += ` Timing ranges from ${fmtTime(ctx.analysis, Math.round(L.time.p10), ctx.tz)} to ${fmtTime(ctx.analysis, Math.round(L.time.p90), ctx.tz)}.`;
    ev2.push({ label: 'Ensemble landfall', value: pct(L.probability), source: 'ensemble' });
  } else if (!cone) text += ' Ensemble guidance is still running.';
  return { text, evidence: ev2, focus: { eventId: ev.id, t: lf ? Math.round(lf.t / 6) * 6 : undefined } };
}

function intensityAnswer(ctx: IntelContext, ev: EventTrack): Answer {
  const i = nowIndex(ev);
  const p = ev.points[i];
  const peak = ev.points[ev.peakIndex];
  if (ev.kind !== 'cyclone') {
    return { text: `${titleOf(ev)} peaks around ${fmtTime(ctx.analysis, peak.t, ctx.tz)}.`, evidence: [], focus: { eventId: ev.id, t: peak.t } };
  }
  const cone = ctx.cones[ev.id];
  const e = cone?.ellipses.find((x) => x.t === peak.t);
  let text = `Now ${Math.round(p.vmax ?? 0)} kt (${kmh(p.vmax ?? 0)} km/h), a ${catName(p.cat).toLowerCase()}. `;
  text +=
    ev.peakIndex > i
      ? `The model peaks it at ${Math.round(peak.vmax ?? 0)} kt (${catName(peak.cat).toLowerCase()}) around ${fmtTime(ctx.analysis, peak.t, ctx.tz)}.`
      : 'It has already passed its peak and is expected to weaken.';
  const evd: Evidence[] = [{ label: 'Model peak', value: `${Math.round(peak.vmax ?? 0)} kt`, source: 'model' }];
  if (e) {
    text += ` Ensemble members range from ${Math.round(e.vmax.p10)} to ${Math.round(e.vmax.p90)} kt at that time.`;
    evd.push({ label: 'Ensemble 10–90%', value: `${Math.round(e.vmax.p10)}–${Math.round(e.vmax.p90)} kt`, source: 'ensemble' });
  }
  const an = ctx.analogs[ev.id];
  if (an) {
    text += ` ${an.guidance.note}`;
    evd.push({ label: 'Analog median peak', value: an.guidance.medianPeakCat, source: 'memory' });
  }
  return { text, evidence: evd, focus: { eventId: ev.id, t: peak.t } };
}

function riAnswer(ctx: IntelContext, ev: EventTrack): Answer {
  const ri = ctx.ri[ev.id];
  if (!ri || !ctx.riModel) return { text: 'Rapid-intensification guidance applies only to cyclonic systems over the sea.', evidence: [], focus: { eventId: ev.id } };
  const ups = ri.contributions.filter((c) => c.effect > 0.05).slice(0, 3);
  const downs = ri.contributions.filter((c) => c.effect < -0.05).slice(0, 2);
  const fmt = (c: (typeof ri.contributions)[number]) => `${c.feature.toLowerCase()} (${c.value.toFixed(c.feature === 'Mid-level humidity' ? 2 : 1)})`;
  return {
    text: `Chance of rapid intensification (+30 kt in 24 h): ${pct(ri.probability)}, against a ${pct(ctx.riModel.climatology)} base rate. ${ups.length ? `Pushing it up: ${joinList(ups.map(fmt))}.` : ''} ${downs.length ? `Holding it back: ${joinList(downs.map(fmt))}.` : ''}`.trim(),
    evidence: [
      { label: 'RI probability', value: pct(ri.probability), source: 'ri' },
      { label: 'Trained on', value: `${ctx.riModel.samples} archive points`, source: 'ri' },
      { label: 'Skill (AUC)', value: ctx.riModel.auc.toFixed(2), source: 'ri' },
    ],
    focus: { eventId: ev.id },
  };
}

function trendAnswer(ctx: IntelContext, ev: EventTrack): Answer {
  const tr = ctx.trends[ev.id];
  if (!tr) return { text: 'Earlier cycles are still being computed.', evidence: [], focus: { eventId: ev.id } };
  const lfs = tr.runs.filter((r) => r.landfall).map((r) => `${r.init === 0 ? 'this run' : `${-r.init} h ago`}: ${r.landfall!.place}`);
  return {
    text: `${tr.note}${lfs.length ? ` Landfall by cycle: ${lfs.join('; ')}.` : ''}`,
    evidence: [{ label: 'Verdict', value: tr.verdict, source: 'cycles' }],
    focus: { eventId: ev.id },
  };
}

function analogAnswer(ctx: IntelContext, ev: EventTrack): Answer {
  const an = ctx.analogs[ev.id];
  if (!an || !an.list.length) return { text: 'Event Memory is still loading.', evidence: [], focus: { eventId: ev.id } };
  const top = an.list.slice(0, 3).map((a) => `${a.event.name ? `${a.event.name} ` : ''}${a.event.label} (${pct(a.similarity)})`);
  return {
    text: `Closest relatives: ${joinList(top)}. ${an.guidance.note} ${pct(an.guidance.landfallP)} of them made landfall.`,
    evidence: an.list.slice(0, 3).map((a) => ({ label: a.event.label, value: `${a.event.maxCat}, ${pct(a.similarity)} similar`, source: 'memory' as const })),
    focus: { eventId: ev.id },
  };
}

function confidenceAnswer(ctx: IntelContext, ev: EventTrack): Answer {
  const cone = ctx.cones[ev.id];
  if (!cone) return { text: 'The ensemble is still running; confidence will be available shortly.', evidence: [], focus: { eventId: ev.id } };
  const tr = ctx.trends[ev.id];
  return {
    text: `Track confidence is ${cone.confidence}. ${cone.members} of ${ctx.members ?? '?'} members follow this system${cone.spread72 !== null ? `, spread ${Math.round(cone.spread72)} km at 72 h` : ''}.${tr ? ` Cycle-to-cycle: ${tr.verdict}.` : ''}`,
    evidence: [{ label: 'Spread at 72 h', value: cone.spread72 !== null ? `${Math.round(cone.spread72)} km` : 'n/a', source: 'ensemble' }],
    focus: { eventId: ev.id },
  };
}

function cityAnswer(ctx: IntelContext, city: City): Answer {
  const o = ctx.outlooks.find((x) => x.city.id === city.id);
  const evd: Evidence[] = [];
  const parts: string[] = [];
  for (const [id, cone] of Object.entries(ctx.cones)) {
    const ct = cone.cities.find((c) => c.city.id === city.id);
    if (!ct || (ct.pGale < 0.05 && ct.pNear < 0.05)) continue;
    const ev = ctx.events.find((e) => e.id === id);
    parts.push(
      `${ev ? titleOf(ev) : 'A cyclone'}: ${pct(ct.pGale)} chance of gale-force winds (34 kt+)${ct.pStorm >= 0.05 ? `, ${pct(ct.pStorm)} storm-force` : ''}${
        ct.arrival ? `, arriving between ${fmtTime(ctx.analysis, Math.round(ct.arrival.p10), ctx.tz)} and ${fmtTime(ctx.analysis, Math.round(ct.arrival.p90), ctx.tz)}` : ''
      }.`,
    );
    evd.push({ label: `Gale chance (${ev?.label ?? id})`, value: pct(ct.pGale), source: 'ensemble' });
  }
  if (o) {
    const worst = o.days.reduce((a, b) => (b.level > a.level ? b : a), o.days[0]);
    if (worst.level > 0) {
      parts.push(
        `Highest warning: ${WARN_LEVELS[worst.level].name} on day ${worst.day} for ${joinList(worst.hazards.filter((h) => h.level === worst.level).map((h) => h.text))}.`,
      );
      evd.push({ label: 'Warning', value: `${WARN_LEVELS[worst.level].name}, day ${worst.day}`, source: 'warnings' });
    }
  }
  if (!parts.length) parts.push(`No significant hazard is forecast for ${city.name} in the next five days.`);
  return { text: `${city.name}: ${parts.join(' ')}`, evidence: evd, focus: { cityId: city.id } };
}

function warningsAnswer(ctx: IntelContext, city: City | null): Answer {
  if (city) return cityAnswer(ctx, city);
  const red = ctx.outlooks.filter((o) => o.maxLevel === 3).map((o) => o.city.name);
  const orange = ctx.outlooks.filter((o) => o.maxLevel === 2).map((o) => o.city.name);
  const now = ctx.decisions.filter((d) => d.status === 'act-now');
  let text = red.length ? `Red: ${joinList(red.slice(0, 8))}${red.length > 8 ? ` and ${red.length - 8} more` : ''}. ` : 'No red warnings. ';
  if (orange.length) text += `Orange: ${joinList(orange.slice(0, 8))}${orange.length > 8 ? ` and ${orange.length - 8} more` : ''}. `;
  if (now.length) text += `Act now: ${joinList([...new Set(now.slice(0, 6).map((d) => `${lowerFirst(d.action.label)} (${d.city.name})`))])}.`;
  return {
    text: text.trim(),
    evidence: [
      { label: 'Red', value: String(red.length), source: 'warnings' },
      { label: 'Orange', value: String(orange.length), source: 'warnings' },
    ],
  };
}

export { SUGGESTIONS, catIndex };
