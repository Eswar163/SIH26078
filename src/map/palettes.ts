// Colour ramps for gridded fields. Each ramp is a list of [value, rgba] stops;
// a 256-entry lookup table is built once per ramp.
// Severity colours (IMD green/yellow/orange/red) and the track magenta are
// deliberately absent from field ramps, except the strike-probability ramp,
// which belongs to the forecast-track family.

export interface Ramp {
  id: string;
  label: string;
  unit: string;
  stops: [number, string][];
  ticks: number[];
  min: number;
  max: number;
  /** Values below this are fully transparent. */
  floor?: number;
}

function ramp(id: string, label: string, unit: string, stops: [number, string][], ticks: number[], floor?: number): Ramp {
  return { id, label, unit, stops, ticks, min: stops[0][0], max: stops[stops.length - 1][0], floor };
}

export const RAMPS: Record<string, Ramp> = {
  rain6: ramp(
    'rain6',
    'Rain, 6 h',
    'mm',
    [
      [0.5, 'rgba(206,233,226,0)'],
      [1, 'rgba(197,229,222,0.55)'],
      [3, 'rgba(160,212,204,0.75)'],
      [7, 'rgba(104,186,182,0.85)'],
      [15, 'rgba(57,154,166,0.9)'],
      [30, 'rgba(36,118,154,0.92)'],
      [50, 'rgba(41,84,145,0.94)'],
      [80, 'rgba(62,58,136,0.95)'],
      [130, 'rgba(78,36,112,0.96)'],
    ],
    [1, 7, 15, 30, 50, 80, 130],
    0.5,
  ),
  rain24: ramp(
    'rain24',
    'Rain, 24 h',
    'mm',
    [
      [2.5, 'rgba(206,233,226,0)'],
      [5, 'rgba(197,229,222,0.55)'],
      [15.6, 'rgba(160,212,204,0.75)'],
      [35.6, 'rgba(104,186,182,0.85)'],
      [64.5, 'rgba(46,136,160,0.9)'],
      [115.6, 'rgba(41,84,145,0.94)'],
      [204.5, 'rgba(62,58,136,0.95)'],
      [300, 'rgba(78,36,112,0.96)'],
    ],
    [15.6, 35.6, 64.5, 115.6, 204.5],
    2.5,
  ),
  t2m: ramp(
    't2m',
    'Temperature',
    '°C',
    [
      [-10, 'rgba(61,90,140,0.78)'],
      [0, 'rgba(111,147,184,0.72)'],
      [10, 'rgba(169,196,214,0.62)'],
      [20, 'rgba(229,225,200,0.5)'],
      [28, 'rgba(234,201,138,0.6)'],
      [35, 'rgba(226,150,82,0.7)'],
      [42, 'rgba(201,96,50,0.78)'],
      [48, 'rgba(150,40,30,0.85)'],
    ],
    [0, 10, 20, 30, 40],
  ),
  tmax: ramp(
    'tmax',
    'Max temperature, 24 h',
    '°C',
    [
      [10, 'rgba(111,147,184,0.7)'],
      [20, 'rgba(169,196,214,0.6)'],
      [28, 'rgba(229,225,200,0.5)'],
      [34, 'rgba(234,201,138,0.62)'],
      [38, 'rgba(228,160,90,0.72)'],
      [42, 'rgba(208,108,56,0.8)'],
      [45, 'rgba(176,58,36,0.86)'],
      [48, 'rgba(120,24,24,0.9)'],
    ],
    [20, 30, 38, 42, 45],
  ),
  wind: ramp(
    'wind',
    'Wind speed',
    'kt',
    [
      [8, 'rgba(233,238,240,0)'],
      [15, 'rgba(206,219,225,0.45)'],
      [25, 'rgba(170,194,205,0.6)'],
      [34, 'rgba(129,160,178,0.72)'],
      [48, 'rgba(92,124,147,0.8)'],
      [64, 'rgba(62,92,116,0.86)'],
      [90, 'rgba(38,62,84,0.9)'],
      [120, 'rgba(20,36,52,0.94)'],
    ],
    [15, 34, 48, 64, 90],
    8,
  ),
  sst: ramp(
    'sst',
    'Sea surface temperature',
    '°C',
    [
      [24, 'rgba(178,206,214,0.75)'],
      [26, 'rgba(214,224,206,0.7)'],
      [27.5, 'rgba(232,222,182,0.72)'],
      [28.5, 'rgba(236,194,128,0.78)'],
      [29.5, 'rgba(224,150,86,0.82)'],
      [31, 'rgba(192,96,56,0.86)'],
    ],
    [26, 27, 28, 29, 30],
  ),
  shear: ramp(
    'shear',
    'Vertical wind shear',
    'kt',
    [
      [0, 'rgba(226,236,222,0.6)'],
      [10, 'rgba(184,210,178,0.65)'],
      [20, 'rgba(226,196,124,0.72)'],
      [30, 'rgba(212,134,80,0.78)'],
      [45, 'rgba(164,72,50,0.84)'],
    ],
    [10, 20, 30, 40],
  ),
  strike: ramp(
    'strike',
    'Strike probability, centre within 120 km',
    '%',
    [
      [0.03, 'rgba(176,19,107,0)'],
      [0.1, 'rgba(176,19,107,0.12)'],
      [0.3, 'rgba(176,19,107,0.24)'],
      [0.5, 'rgba(176,19,107,0.36)'],
      [0.7, 'rgba(176,19,107,0.5)'],
      [0.9, 'rgba(120,10,72,0.62)'],
    ],
    [0.1, 0.3, 0.5, 0.7, 0.9],
    0.03,
  ),
  probRain: ramp(
    'probRain',
    'Chance of heavy rain (64.5 mm+)',
    '%',
    [
      [0.05, 'rgba(42,127,147,0)'],
      [0.1, 'rgba(42,127,147,0.18)'],
      [0.3, 'rgba(42,127,147,0.34)'],
      [0.5, 'rgba(36,104,140,0.5)'],
      [0.7, 'rgba(41,74,134,0.62)'],
      [0.9, 'rgba(56,48,120,0.72)'],
    ],
    [0.1, 0.3, 0.5, 0.7, 0.9],
    0.05,
  ),
  probGale: ramp(
    'probGale',
    'Chance of gale-force wind (34 kt+)',
    '%',
    [
      [0.05, 'rgba(62,92,116,0)'],
      [0.1, 'rgba(62,92,116,0.18)'],
      [0.3, 'rgba(62,92,116,0.32)'],
      [0.5, 'rgba(48,74,98,0.46)'],
      [0.7, 'rgba(34,56,78,0.58)'],
      [0.9, 'rgba(20,36,52,0.7)'],
    ],
    [0.1, 0.3, 0.5, 0.7, 0.9],
    0.05,
  ),
  probHeat: ramp(
    'probHeat',
    'Chance of heat-wave conditions',
    '%',
    [
      [0.05, 'rgba(201,89,42,0)'],
      [0.1, 'rgba(201,89,42,0.16)'],
      [0.3, 'rgba(201,89,42,0.3)'],
      [0.5, 'rgba(190,74,36,0.44)'],
      [0.7, 'rgba(170,56,30,0.56)'],
      [0.9, 'rgba(140,34,24,0.68)'],
    ],
    [0.1, 0.3, 0.5, 0.7, 0.9],
    0.05,
  ),
  probCold: ramp(
    'probCold',
    'Chance of cold-wave conditions',
    '%',
    [
      [0.05, 'rgba(61,110,168,0)'],
      [0.1, 'rgba(61,110,168,0.16)'],
      [0.3, 'rgba(61,110,168,0.3)'],
      [0.5, 'rgba(52,94,150,0.44)'],
      [0.7, 'rgba(42,76,130,0.56)'],
      [0.9, 'rgba(32,58,110,0.68)'],
    ],
    [0.1, 0.3, 0.5, 0.7, 0.9],
    0.05,
  ),
  genesis: ramp(
    'genesis',
    'Chance of a new depression forming nearby (300 km)',
    '%',
    [
      [0.05, 'rgba(90,104,112,0)'],
      [0.1, 'rgba(90,104,112,0.2)'],
      [0.3, 'rgba(70,84,92,0.34)'],
      [0.5, 'rgba(50,64,72,0.48)'],
      [0.8, 'rgba(30,44,52,0.62)'],
    ],
    [0.1, 0.3, 0.5, 0.8],
    0.05,
  ),
};

function parse(c: string): [number, number, number, number] {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return [0, 0, 0, 0];
  const parts = m[1].split(',').map((x) => parseFloat(x));
  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
}

const lutCache = new Map<string, Uint8ClampedArray>();

/** 256-entry RGBA lookup table spanning [min, max]. */
export function lut(r: Ramp): Uint8ClampedArray {
  const hit = lutCache.get(r.id);
  if (hit) return hit;
  const out = new Uint8ClampedArray(256 * 4);
  const stops = r.stops.map(([v, c]) => [v, parse(c)] as [number, [number, number, number, number]]);
  for (let i = 0; i < 256; i++) {
    const v = r.min + ((r.max - r.min) * i) / 255;
    let k = 0;
    while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
    const [v0, c0] = stops[k];
    const [v1, c1] = stops[k + 1];
    const f = Math.max(0, Math.min(1, (v - v0) / (v1 - v0 || 1)));
    out[i * 4] = c0[0] + (c1[0] - c0[0]) * f;
    out[i * 4 + 1] = c0[1] + (c1[1] - c0[1]) * f;
    out[i * 4 + 2] = c0[2] + (c1[2] - c0[2]) * f;
    out[i * 4 + 3] = (c0[3] + (c1[3] - c0[3]) * f) * 255;
  }
  lutCache.set(r.id, out);
  return out;
}

export function rampCss(r: Ramp): string {
  return `linear-gradient(90deg, ${r.stops.map(([v, c]) => `${c.replace(/,\s*0\)$/, ',0.25)')} ${(((v - r.min) / (r.max - r.min)) * 100).toFixed(1)}%`).join(', ')})`;
}
