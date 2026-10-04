// India Meteorological Department scales: cyclonic disturbance classes,
// rainfall intensity, heat and cold wave criteria, and the colour-coded
// impact-based warning matrix.

export type CycloneCat = 'L' | 'WML' | 'D' | 'DD' | 'CS' | 'SCS' | 'VSCS' | 'ESCS' | 'SuCS';

export const CYCLONE_SCALE: { code: CycloneCat; name: string; minKt: number }[] = [
  { code: 'L', name: 'Low pressure area', minKt: 0 },
  { code: 'WML', name: 'Well-marked low', minKt: 0 },
  { code: 'D', name: 'Depression', minKt: 17 },
  { code: 'DD', name: 'Deep depression', minKt: 28 },
  { code: 'CS', name: 'Cyclonic storm', minKt: 34 },
  { code: 'SCS', name: 'Severe cyclonic storm', minKt: 48 },
  { code: 'VSCS', name: 'Very severe cyclonic storm', minKt: 64 },
  { code: 'ESCS', name: 'Extremely severe cyclonic storm', minKt: 90 },
  { code: 'SuCS', name: 'Super cyclonic storm', minKt: 120 },
];

export function cycloneCat(vmaxKt: number, closedIsobars = 1): CycloneCat {
  if (vmaxKt >= 120) return 'SuCS';
  if (vmaxKt >= 90) return 'ESCS';
  if (vmaxKt >= 64) return 'VSCS';
  if (vmaxKt >= 48) return 'SCS';
  if (vmaxKt >= 34) return 'CS';
  if (vmaxKt >= 28) return 'DD';
  if (vmaxKt >= 17) return 'D';
  return closedIsobars >= 2 ? 'WML' : 'L';
}

export function catIndex(code: string): number {
  const i = CYCLONE_SCALE.findIndex((c) => c.code === code);
  return i < 0 ? 0 : i;
}

export function catName(code: string): string {
  return CYCLONE_SCALE.find((c) => c.code === code)?.name ?? code;
}

/** Lower bound of each class on the wind axis, used to draw category bands. */
export const CAT_BANDS: { code: CycloneCat; from: number; to: number }[] = [
  { code: 'L', from: 0, to: 17 },
  { code: 'D', from: 17, to: 28 },
  { code: 'DD', from: 28, to: 34 },
  { code: 'CS', from: 34, to: 48 },
  { code: 'SCS', from: 48, to: 64 },
  { code: 'VSCS', from: 64, to: 90 },
  { code: 'ESCS', from: 90, to: 120 },
  { code: 'SuCS', from: 120, to: 160 },
];

export const KT_TO_KMH = 1.852;
export const MS_TO_KT = 1.943844;

export type RainCat = 'heavy' | 'very heavy' | 'extremely heavy';

export function rainCat(mm24: number): RainCat | null {
  if (mm24 >= 204.5) return 'extremely heavy';
  if (mm24 >= 115.6) return 'very heavy';
  if (mm24 >= 64.5) return 'heavy';
  return null;
}

export const RAIN_THRESHOLDS = { heavy: 64.5, veryHeavy: 115.6, extreme: 204.5 } as const;

/** IMD heat-wave test for one location. 0 none, 1 heat wave, 2 severe heat wave. */
export function heatWaveClass(tmax: number, normal: number, elevM: number, coastal: boolean): 0 | 1 | 2 {
  const dep = tmax - normal;
  if (elevM >= 1000) {
    if (tmax < 30) return 0;
    return dep >= 6.5 ? 2 : dep >= 4.5 ? 1 : 0;
  }
  if (coastal) {
    if (tmax < 37) return 0;
    return dep >= 6.5 ? 2 : dep >= 4.5 ? 1 : 0;
  }
  // Plains: the stronger of the absolute and the departure criteria.
  const absolute = dep >= 2 ? (tmax >= 47 ? 2 : tmax >= 45 ? 1 : 0) : 0;
  const departure = tmax >= 40 ? (dep >= 6.5 ? 2 : dep >= 4.5 ? 1 : 0) : 0;
  return Math.max(absolute, departure) as 0 | 1 | 2;
}

/** IMD cold-wave test. 0 none, 1 cold wave, 2 severe cold wave. */
export function coldWaveClass(tmin: number, normal: number, elevM: number): 0 | 1 | 2 {
  const dep = tmin - normal;
  if (elevM >= 1000) {
    if (tmin > 0) return 0;
    return dep <= -6.5 ? 2 : dep <= -4.5 ? 1 : 0;
  }
  const absolute = dep <= -2 ? (tmin <= 2 ? 2 : tmin <= 4 ? 1 : 0) : 0;
  const departure = tmin <= 10 ? (dep <= -6.5 ? 2 : dep <= -4.5 ? 1 : 0) : 0;
  return Math.max(absolute, departure) as 0 | 1 | 2;
}

// ---------------------------------------------------------------------------
// Impact-based warnings

export type WarnLevel = 0 | 1 | 2 | 3;

export const WARN_LEVELS: { level: WarnLevel; colour: string; name: string; advice: string }[] = [
  { level: 0, colour: 'green', name: 'Green', advice: 'No action' },
  { level: 1, colour: 'yellow', name: 'Yellow', advice: 'Be updated' },
  { level: 2, colour: 'orange', name: 'Orange', advice: 'Be prepared' },
  { level: 3, colour: 'red', name: 'Red', advice: 'Take action' },
];

/**
 * Likelihood x impact matrix used for colour-coded warnings.
 * likelihood and impact are 0 (very low) .. 3 (high).
 */
const MATRIX: WarnLevel[][] = [
  // impact: very low, low, medium, high
  [0, 0, 1, 1], // very low likelihood
  [0, 1, 1, 2], // low
  [0, 1, 2, 3], // medium
  [0, 1, 2, 3], // high
];

export function riskMatrix(likelihood: number, impact: number): WarnLevel {
  const l = Math.max(0, Math.min(3, Math.round(likelihood)));
  const i = Math.max(0, Math.min(3, Math.round(impact)));
  return MATRIX[l][i];
}

export function likelihoodClass(p: number): 0 | 1 | 2 | 3 {
  if (p >= 0.6) return 3;
  if (p >= 0.3) return 2;
  if (p >= 0.1) return 1;
  return 0;
}

export const LIKELIHOOD_WORDS = ['very low', 'low', 'medium', 'high'] as const;
export const IMPACT_WORDS = ['very low', 'low', 'medium', 'high'] as const;
