// The synoptic chart. A canvas renderer with pan and zoom, hit-testing for
// events, a probe readout and an animated wind-flow layer.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Cone } from '../engine/cone';
import type { CityOutlook } from '../engine/decision';
import type { EventTrack } from '../engine/events';
import type { GridSpec } from '../engine/grid';
import { sample } from '../engine/grid';
import { catName } from '../engine/imd';
import { IconMinus, IconPlus, IconTarget } from '../ui/icons';
import {
  drawBarbs,
  drawCities,
  drawCoast,
  drawCone,
  drawEventNow,
  drawGhost,
  drawGraticule,
  drawIsolines,
  drawRaster,
  drawRegion,
  drawSeaAndLand,
  drawSpaghetti,
  drawTrack,
  drawTruth,
  isoSet,
  rasterCanvas,
  readTheme,
  type Frame,
  type Theme,
} from './draw';
import { rampCss, type Ramp } from './palettes';
import { FlowLayer } from './particles';
import { clampView, fit, kmPerPx, project, unproject, zoomAt, type MapViewState } from './view';

export interface RasterSpec {
  grid: GridSpec;
  data: ArrayLike<number>;
  ramp: Ramp;
  scale?: number;
  mask?: Float32Array;
  maskMode?: 'land' | 'sea';
  alpha?: number;
}

export interface MapViewProps {
  grid: GridSpec;
  raster?: RasterSpec | null;
  prob?: RasterSpec | null;
  mslp?: Float32Array | null;
  z500?: Float32Array | null;
  wind?: { u: Float32Array; v: Float32Array; mode: 'off' | 'flow' | 'barbs' } | null;
  events: EventTrack[];
  t: number;
  selectedId?: string | null;
  hoverId?: string | null;
  regions?: boolean;
  cone?: Cone | null;
  ellipses?: boolean;
  spaghetti?: { points: { t: number; lon: number; lat: number }[] }[] | null;
  ghosts?: { id: string; label: string; points: { lon: number; lat: number }[] }[];
  cycleTracks?: { init: number; label: string; points: { lon: number; lat: number }[] }[];
  truth?: { id: number; points: { lon: number; lat: number; t: number }[] }[];
  cities?: boolean;
  warnings?: boolean;
  outlooks?: CityOutlook[] | null;
  warnDay?: number;
  focusCity?: string | null;
  view?: MapViewState | null;
  onViewChange?: (v: MapViewState) => void;
  onSelect?: (id: string | null) => void;
  onHover?: (id: string | null) => void;
  probe?: (lon: number, lat: number) => { label: string; value: string }[];
  fmtShort: (t: number) => string;
  label?: string;
  themeKey: string;
  legend?: boolean;
  extraDraw?: (f: Frame) => void;
  fitBox?: { w: number; e: number; s: number; n: number };
}

interface Hit {
  id: string;
  x: number;
  y: number;
  r: number;
}

function eventLabel(ev: EventTrack): string {
  if (ev.kind === 'cyclone') return ev.name ?? ev.label;
  return ev.label;
}

function eventSub(ev: EventTrack, i: number): string {
  const p = ev.points[i];
  if (ev.kind === 'cyclone') return `${p.cat} ${Math.round(p.vmax ?? 0)} kt ${Math.round(p.pmin ?? 0)} hPa`;
  if (ev.kind === 'wd') return `${Math.round(p.amp ?? 0)} gpm trough`;
  if (ev.kind === 'heat' || ev.kind === 'cold') return `${(p.peak ?? 0).toFixed(1)} °C`;
  return `${Math.round(p.peak ?? 0)} mm`;
}

export function MapView(props: MapViewProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const flowCanvas = useRef<HTMLCanvasElement>(null);
  const flow = useRef<FlowLayer | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0, dpr: 1 });
  const [innerView, setInnerView] = useState<MapViewState | null>(null);
  const view = props.view ?? innerView;
  const viewRef = useRef(view);
  viewRef.current = view;
  const hits = useRef<Hit[]>([]);
  const [readout, setReadout] = useState<{ lon: number; lat: number; items: { label: string; value: string }[] } | null>(null);
  const theme = useMemo<Theme | null>(() => (typeof document !== 'undefined' ? readTheme() : null), [props.themeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const reduceMotion = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  const setView = useCallback(
    (v: MapViewState) => {
      const c = clampView(v, size.w, size.h);
      if (props.onViewChange) props.onViewChange(c);
      else setInnerView(c);
    },
    [props, size.w, size.h],
  );

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)), dpr: Math.min(2, window.devicePixelRatio || 1) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!size.w || view) return;
    const v = clampView(fit(size.w, size.h, props.fitBox), size.w, size.h);
    if (props.onViewChange) props.onViewChange(v);
    else setInnerView(v);
  }, [size.w, size.h, view, props]);

  // --------------------------------------------------------------- draw
  const draw = useCallback(() => {
    const canvas = base.current;
    if (!canvas || !view || !theme || !size.w) return;
    if (canvas.width !== Math.round(size.w * size.dpr) || canvas.height !== Math.round(size.h * size.dpr)) {
      canvas.width = Math.round(size.w * size.dpr);
      canvas.height = Math.round(size.h * size.dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    const f: Frame = { ctx, view, w: size.w, h: size.h, theme };
    const land = drawSeaAndLand(f);
    if (props.raster) {
      const r = props.raster;
      drawRaster(f, r.grid, rasterCanvas(r.grid, r.data, r.ramp, r.scale ?? 1, r.mask, r.maskMode), r.alpha ?? 1);
    }
    if (props.prob) {
      const r = props.prob;
      drawRaster(f, r.grid, rasterCanvas(r.grid, r.data, r.ramp, r.scale ?? 1), r.alpha ?? 1);
    }
    drawCoast(f, land);
    drawGraticule(f);
    if (props.prob) {
      const iso = isoSet(props.prob.grid, props.prob.data as Float32Array, 0.2, 1, `prob:${props.prob.ramp.id}`);
      drawIsolines(f, { levels: iso.levels.filter((l) => l.level > 0.05 && l.level < 0.95) }, {
        color: props.prob.ramp.id === 'strike' ? theme.track : theme.ink2,
        width: 0.8,
        label: (v) => `${Math.round(v * 100)}%`,
        labelEvery: 320,
      });
    }
    if (props.z500) {
      drawIsolines(f, isoSet(props.grid, props.z500, 40, 2, 'z500'), {
        color: theme.dark ? 'rgba(206,170,120,0.85)' : 'rgba(140,90,40,0.75)',
        width: 0.9,
        boldEvery: 120,
        dash: [5, 3],
        label: (v) => `${Math.round(v / 10)}`,
        labelEvery: 300,
      });
    }
    if (props.mslp) {
      drawIsolines(f, isoSet(props.grid, props.mslp, 2, 2, 'mslp'), {
        color: theme.dark ? 'rgba(220,230,233,0.72)' : 'rgba(21,35,43,0.7)',
        width: 0.85,
        boldEvery: 10,
        label: (v) => `${Math.round(v)}`,
        labelEvery: 280,
      });
    }
    if (props.wind?.mode === 'barbs') {
      const g = props.grid;
      drawBarbs(f, g, props.wind.u, props.wind.v, (arr, lon, lat) => sample(g, arr, lon, lat), (x, y) => unproject(view, size.w, size.h, x, y));
    }
    props.extraDraw?.(f);
    const t = props.t;
    const occupied: { x: number; y: number; w: number; h: number }[] = [];
    // Areal events first, beneath tracks.
    if (props.regions !== false) {
      for (const ev of props.events) {
        if (ev.kind === 'cyclone' || ev.kind === 'wd') continue;
        const p = ev.points.find((q) => q.t === t);
        if (p) drawRegion(f, ev, p, ev.id === props.selectedId);
      }
    }
    for (const g of props.ghosts ?? []) drawGhost(f, g.points, g.label, theme.graphite);
    for (const c of props.cycleTracks ?? []) drawGhost(f, c.points, c.label, theme.track2, [5, 2]);
    if (props.spaghetti?.length) drawSpaghetti(f, props.spaghetti, theme.track, theme.dark ? 0.42 : 0.3);
    if (props.cone) drawCone(f, props.cone, props.ellipses !== false, props.fmtShort, t);
    for (const tr of props.truth ?? []) drawTruth(f, tr.points, t);
    const ordered = [...props.events].sort((a, b) => (a.id === props.selectedId ? 1 : 0) - (b.id === props.selectedId ? 1 : 0));
    for (const ev of ordered) drawTrack(f, ev, t, { selected: ev.id === props.selectedId, hovered: ev.id === props.hoverId }, props.fmtShort);
    // Warning colours exist for forecast days 1 to 5 only.
    const warnDay = Math.max(1, Math.ceil(t / 24));
    const showWarn = props.warnings !== false && t >= 0 && t <= 120;
    if (props.cities !== false) drawCities(f, showWarn ? props.outlooks ?? null : null, warnDay, showWarn, props.focusCity ?? null, occupied);
    const newHits: Hit[] = [];
    for (const ev of ordered) {
      const i = ev.points.findIndex((q) => q.t === t);
      if (i < 0) continue;
      const vortex = ev.kind === 'cyclone' || ev.kind === 'wd';
      const show = vortex || ev.id === props.selectedId || ev.id === props.hoverId;
      const labelled = vortex || ev.id === props.selectedId;
      const [x, y] = show
        ? drawEventNow(f, ev, ev.points[i], { selected: ev.id === props.selectedId, hovered: ev.id === props.hoverId }, labelled ? eventLabel(ev) : '', labelled ? eventSub(ev, i) : '')
        : project(view, size.w, size.h, ev.points[i].lon, ev.points[i].lat);
      newHits.push({ id: ev.id, x, y, r: vortex ? 16 : 12 });
    }
    hits.current = newHits;
  }, [props, view, size, theme]);

  useEffect(() => {
    const id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, [draw]);

  // --------------------------------------------------------------- wind flow
  const windU = props.wind?.u ?? null;
  const windV = props.wind?.v ?? null;
  const windMode = props.wind?.mode ?? 'off';
  useEffect(() => {
    if (!flowCanvas.current) return;
    if (!flow.current) flow.current = new FlowLayer(flowCanvas.current);
    const fl = flow.current;
    const on = windMode === 'flow' && !reduceMotion && !!windU && !!windV;
    if (!on || !view || !size.w) {
      fl.stop();
      return;
    }
    fl.setData(props.grid, windU!, windV!);
    fl.setColor(theme?.dark ? 'rgba(226,233,235,0.42)' : 'rgba(21,35,43,0.38)');
    fl.setView(view, size.w, size.h, size.dpr);
    fl.start();
    const onVis = () => (document.hidden ? fl.stop() : fl.start());
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // Depend on the arrays and mode, not the wrapper object, so hovering does not reset the particles.
  }, [windU, windV, windMode, props.grid, view, size, theme, reduceMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => flow.current?.stop(), []);

  // --------------------------------------------------------------- interaction
  const drag = useRef<{ x: number; y: number; v: MapViewState; moved: boolean; id: number } | null>(null);
  const pinch = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStart = useRef<{ d: number; v: MapViewState; cx: number; cy: number } | null>(null);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as [number, number];
  };

  const hitAt = (x: number, y: number): string | null => {
    let best: Hit | null = null;
    let bd = Infinity;
    for (const h of hits.current) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < h.r && d < bd) {
        bd = d;
        best = h;
      }
    }
    return best?.id ?? null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!view) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const [x, y] = local(e);
    pinch.current.set(e.pointerId, { x, y });
    if (pinch.current.size === 2) {
      const [a, b] = [...pinch.current.values()];
      pinchStart.current = { d: Math.hypot(a.x - b.x, a.y - b.y), v: view, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      drag.current = null;
      return;
    }
    drag.current = { x, y, v: view, moved: false, id: e.pointerId };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!view) return;
    const [x, y] = local(e);
    if (pinch.current.has(e.pointerId)) pinch.current.set(e.pointerId, { x, y });
    if (pinchStart.current && pinch.current.size === 2) {
      const [a, b] = [...pinch.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const ps = pinchStart.current;
      setView(zoomAt(ps.v, size.w, size.h, ps.cx, ps.cy, d / Math.max(1, ps.d)));
      return;
    }
    const dr = drag.current;
    if (dr && dr.id === e.pointerId) {
      const dx = x - dr.x;
      const dy = y - dr.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) dr.moved = true;
      if (dr.moved) {
        setView({ lon: dr.v.lon - dx / (dr.v.k * Math.cos((20 * Math.PI) / 180)), lat: dr.v.lat + dy / dr.v.k, k: dr.v.k });
        return;
      }
    }
    const id = hitAt(x, y);
    props.onHover?.(id);
    wrap.current!.style.cursor = id ? 'pointer' : dr ? 'grabbing' : 'grab';
    if (props.probe) {
      const [lon, lat] = unproject(view, size.w, size.h, x, y);
      setReadout({ lon, lat, items: props.probe(lon, lat) });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pinch.current.delete(e.pointerId);
    if (pinch.current.size < 2) pinchStart.current = null;
    const dr = drag.current;
    drag.current = null;
    if (!dr || dr.moved || dr.id !== e.pointerId) return;
    const [x, y] = local(e);
    props.onSelect?.(hitAt(x, y));
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!view) return;
    const [x, y] = local(e);
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
    setView(zoomAt(view, size.w, size.h, x, y, factor));
  };

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const prevent = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', prevent, { passive: false });
    return () => el.removeEventListener('wheel', prevent);
  }, []);

  const zoomBy = (factor: number) => view && setView(zoomAt(view, size.w, size.h, size.w / 2, size.h / 2, factor));
  const reset = () => setView(fit(size.w, size.h, props.fitBox));

  const scale = view ? scaleBar(view) : null;
  const legendRamp = props.prob?.ramp ?? props.raster?.ramp ?? null;

  return (
    <div
      className="map"
      ref={wrap}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        setReadout(null);
        props.onHover?.(null);
      }}
      onWheel={onWheel}
      onDoubleClick={(e) => {
        const [x, y] = local(e);
        if (view) setView(zoomAt(view, size.w, size.h, x, y, 1.6));
      }}
      role="img"
      aria-label="Synoptic chart"
    >
      <canvas ref={base} className="map__canvas" style={{ width: size.w, height: size.h }} />
      <canvas ref={flowCanvas} className="map__canvas map__flow" style={{ width: size.w, height: size.h }} />
      {props.label && <div className="map__label">{props.label}</div>}
      <div className="map__zoom" onPointerDown={(e) => e.stopPropagation()}>
        <button className="btn btn--icon" onClick={() => zoomBy(1.4)} aria-label="Zoom in" title="Zoom in">
          <IconPlus />
        </button>
        <button className="btn btn--icon" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out" title="Zoom out">
          <IconMinus />
        </button>
        <button className="btn btn--icon" onClick={reset} aria-label="Fit to region" title="Fit to region">
          <IconTarget />
        </button>
      </div>
      {props.legend !== false && legendRamp && (
        <div className="map__legend" onPointerDown={(e) => e.stopPropagation()}>
          <div className="map__legend-title">
            {legendRamp.label}
            {legendRamp.unit && legendRamp.unit !== '%' ? <span className="muted">, {legendRamp.unit}</span> : null}
          </div>
          <div className="map__legend-bar" style={{ background: rampCss(legendRamp) }} />
          <div className="map__legend-ticks num">
            {legendRamp.ticks.map((tk) => (
              <span key={tk} style={{ left: `${((tk - legendRamp.min) / (legendRamp.max - legendRamp.min)) * 100}%` }}>
                {legendRamp.unit === '%' ? Math.round(tk * 100) : tk}
              </span>
            ))}
          </div>
          {props.mslp && <div className="map__legend-note muted">Isobars every 2 hPa</div>}
        </div>
      )}
      <div className="map__status num">
        {readout ? (
          <>
            <span>
              {readout.lat.toFixed(2)}°N {readout.lon.toFixed(2)}°E
            </span>
            {readout.items.map((it) => (
              <span key={it.label}>
                <span className="muted">{it.label}</span> {it.value}
              </span>
            ))}
          </>
        ) : (
          <span className="muted">Point at the chart to read values. Drag to pan, scroll to zoom.</span>
        )}
        <span className="map__synthetic faint">Synthetic model output, not an official forecast</span>
        {scale && (
          <span className="map__scale" aria-hidden="true">
            <span style={{ width: scale.px }} />
            {scale.km} km
          </span>
        )}
      </div>
    </div>
  );
}

function scaleBar(v: MapViewState) {
  const kpp = kmPerPx(v);
  const target = 90 * kpp;
  const nice = [50, 100, 200, 250, 500, 1000, 2000].find((n) => n >= target * 0.6) ?? 1000;
  return { km: nice, px: Math.round(nice / kpp) };
}

export function categoryLong(code: string) {
  return catName(code);
}
