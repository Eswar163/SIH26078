// Map projection: equirectangular with a standard parallel at 20N (shapes are
// close to true across the Indian region), plus a pan/zoom view state.

export interface MapViewState {
  lon: number;
  lat: number;
  /** Pixels per degree of latitude. */
  k: number;
}

export const COS0 = Math.cos((20 * Math.PI) / 180);

export const BOUNDS = { w: 48, e: 102, s: -2, n: 42 };

export function project(v: MapViewState, w: number, h: number, lon: number, lat: number): [number, number] {
  return [(lon - v.lon) * v.k * COS0 + w / 2, -(lat - v.lat) * v.k + h / 2];
}

export function unproject(v: MapViewState, w: number, h: number, x: number, y: number): [number, number] {
  return [(x - w / 2) / (v.k * COS0) + v.lon, -(y - h / 2) / v.k + v.lat];
}

/** View that fits a lon/lat box into the canvas. */
export function fit(w: number, h: number, box = { w: 55, e: 99, s: 4, n: 37 }, pad = 12): MapViewState {
  const kx = (w - pad * 2) / ((box.e - box.w) * COS0);
  const ky = (h - pad * 2) / (box.n - box.s);
  return { lon: (box.w + box.e) / 2, lat: (box.s + box.n) / 2, k: Math.max(4, Math.min(kx, ky)) };
}

export function clampView(v: MapViewState, w: number, h: number): MapViewState {
  const minK = Math.min(w / ((BOUNDS.e - BOUNDS.w) * COS0), h / (BOUNDS.n - BOUNDS.s)) * 0.9;
  const k = Math.max(minK, Math.min(160, v.k));
  const halfW = w / 2 / (k * COS0);
  const halfH = h / 2 / k;
  const lonMin = BOUNDS.w + halfW;
  const lonMax = BOUNDS.e - halfW;
  const latMin = BOUNDS.s + halfH;
  const latMax = BOUNDS.n - halfH;
  const lon = lonMin > lonMax ? (BOUNDS.w + BOUNDS.e) / 2 : Math.max(lonMin, Math.min(lonMax, v.lon));
  const lat = latMin > latMax ? (BOUNDS.s + BOUNDS.n) / 2 : Math.max(latMin, Math.min(latMax, v.lat));
  return { lon, lat, k };
}

export function zoomAt(v: MapViewState, w: number, h: number, x: number, y: number, factor: number): MapViewState {
  const [lon, lat] = unproject(v, w, h, x, y);
  const k = v.k * factor;
  // Keep the point under the cursor fixed.
  const nlon = lon - (x - w / 2) / (k * COS0);
  const nlat = lat + (y - h / 2) / k;
  return { lon: nlon, lat: nlat, k };
}

/** Kilometres per pixel at the view centre, east-west. */
export function kmPerPx(v: MapViewState): number {
  return (111.19 * Math.cos((v.lat * Math.PI) / 180)) / (v.k * COS0);
}
