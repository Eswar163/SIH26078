// Reference places: cities (district headquarters and neighbouring capitals),
// the ordered coastline used for landfall statistics, and the sea areas that
// IMD bulletins use to describe where a system is.
// Populations are approximate urban-agglomeration figures, for exposure estimates only.

import { bearingDeg, compassWords, distKm, nearestOnPolyline } from './geo';

export interface City {
  id: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
  /** Approximate population, thousands. */
  pop: number;
  coastal: boolean;
  /** 1 = always labelled, 2 = labelled from mid zoom, 3 = close zoom only. */
  tier: 1 | 2 | 3;
  country?: string;
}

type Row = [string, string, number, number, number, 0 | 1, 1 | 2 | 3, string?];

const ROWS: Row[] = [
  // name, state, lat, lon, pop (k), coastal, tier, country
  ['Delhi', 'Delhi', 28.61, 77.21, 32000, 0, 1],
  ['Mumbai', 'Maharashtra', 19.08, 72.88, 21000, 1, 1],
  ['Kolkata', 'West Bengal', 22.57, 88.36, 15000, 0, 1],
  ['Chennai', 'Tamil Nadu', 13.08, 80.27, 11500, 1, 1],
  ['Bengaluru', 'Karnataka', 12.97, 77.59, 13000, 0, 1],
  ['Hyderabad', 'Telangana', 17.39, 78.49, 10500, 0, 1],
  ['Ahmedabad', 'Gujarat', 23.02, 72.57, 8400, 0, 1],
  ['Pune', 'Maharashtra', 18.52, 73.86, 7000, 0, 2],
  ['Visakhapatnam', 'Andhra Pradesh', 17.69, 83.22, 2300, 1, 1],
  ['Bhubaneswar', 'Odisha', 20.3, 85.82, 1200, 0, 1],
  ['Jaipur', 'Rajasthan', 26.91, 75.79, 4100, 0, 1],
  ['Lucknow', 'Uttar Pradesh', 26.85, 80.95, 3900, 0, 1],
  ['Patna', 'Bihar', 25.59, 85.14, 2500, 0, 1],
  ['Guwahati', 'Assam', 26.14, 91.74, 1200, 0, 1],
  ['Thiruvananthapuram', 'Kerala', 8.52, 76.94, 1700, 1, 1],
  ['Kochi', 'Kerala', 9.93, 76.27, 2200, 1, 2],
  ['Srinagar', 'Jammu and Kashmir', 34.08, 74.8, 1500, 0, 1],
  ['Bhopal', 'Madhya Pradesh', 23.26, 77.41, 2400, 0, 1],
  ['Nagpur', 'Maharashtra', 21.15, 79.09, 2900, 0, 1],
  ['Surat', 'Gujarat', 21.17, 72.83, 7200, 1, 2],
  ['Kanpur', 'Uttar Pradesh', 26.45, 80.33, 3200, 0, 3],
  ['Indore', 'Madhya Pradesh', 22.72, 75.86, 3200, 0, 2],
  ['Vadodara', 'Gujarat', 22.31, 73.18, 2200, 0, 3],
  ['Coimbatore', 'Tamil Nadu', 11.02, 76.96, 2900, 0, 2],
  ['Madurai', 'Tamil Nadu', 9.93, 78.12, 1700, 0, 2],
  ['Vijayawada', 'Andhra Pradesh', 16.51, 80.65, 1900, 0, 2],
  ['Raipur', 'Chhattisgarh', 21.25, 81.63, 1600, 0, 1],
  ['Ranchi', 'Jharkhand', 23.34, 85.31, 1500, 0, 1],
  ['Chandigarh', 'Chandigarh', 30.73, 76.78, 1200, 0, 1],
  ['Amritsar', 'Punjab', 31.63, 74.87, 1300, 0, 2],
  ['Jodhpur', 'Rajasthan', 26.24, 73.02, 1300, 0, 2],
  ['Varanasi', 'Uttar Pradesh', 25.32, 82.97, 1600, 0, 2],
  ['Agra', 'Uttar Pradesh', 27.18, 78.01, 1900, 0, 3],
  ['Mangaluru', 'Karnataka', 12.91, 74.86, 800, 1, 2],
  ['Panaji', 'Goa', 15.49, 73.83, 600, 1, 1],
  ['Kozhikode', 'Kerala', 11.26, 75.78, 2300, 1, 2],
  ['Puducherry', 'Puducherry', 11.94, 79.81, 1200, 1, 2],
  ['Tiruchirappalli', 'Tamil Nadu', 10.79, 78.7, 1100, 0, 3],
  ['Thoothukudi', 'Tamil Nadu', 8.76, 78.13, 500, 1, 3],
  ['Nellore', 'Andhra Pradesh', 14.44, 79.99, 700, 1, 2],
  ['Kakinada', 'Andhra Pradesh', 16.99, 82.25, 500, 1, 2],
  ['Machilipatnam', 'Andhra Pradesh', 16.19, 81.14, 200, 1, 2],
  ['Puri', 'Odisha', 19.81, 85.83, 300, 1, 2],
  ['Cuttack', 'Odisha', 20.46, 85.88, 700, 0, 3],
  ['Brahmapur', 'Odisha', 19.31, 84.79, 400, 1, 2],
  ['Paradip', 'Odisha', 20.32, 86.61, 70, 1, 3],
  ['Balasore', 'Odisha', 21.49, 86.93, 150, 1, 2],
  ['Digha', 'West Bengal', 21.63, 87.51, 20, 1, 3],
  ['Haldia', 'West Bengal', 22.06, 88.07, 200, 1, 3],
  ['Rajkot', 'Gujarat', 22.3, 70.8, 1600, 0, 2],
  ['Jamnagar', 'Gujarat', 22.47, 70.06, 700, 1, 3],
  ['Porbandar', 'Gujarat', 21.64, 69.61, 200, 1, 2],
  ['Veraval', 'Gujarat', 20.91, 70.37, 200, 1, 3],
  ['Bhuj', 'Gujarat', 23.24, 69.67, 200, 0, 2],
  ['Gandhidham', 'Gujarat', 23.08, 70.13, 300, 1, 3],
  ['Dwarka', 'Gujarat', 22.24, 68.97, 40, 1, 3],
  ['Ratnagiri', 'Maharashtra', 16.99, 73.31, 80, 1, 2],
  ['Alibag', 'Maharashtra', 18.64, 72.87, 20, 1, 3],
  ['Karwar', 'Karnataka', 14.81, 74.13, 80, 1, 3],
  ['Udupi', 'Karnataka', 13.34, 74.75, 170, 1, 3],
  ['Kannur', 'Kerala', 11.87, 75.37, 500, 1, 3],
  ['Alappuzha', 'Kerala', 9.5, 76.34, 200, 1, 3],
  ['Kollam', 'Kerala', 8.89, 76.61, 400, 1, 3],
  ['Kanyakumari', 'Tamil Nadu', 8.08, 77.54, 30, 1, 3],
  ['Nagapattinam', 'Tamil Nadu', 10.77, 79.84, 100, 1, 2],
  ['Cuddalore', 'Tamil Nadu', 11.75, 79.75, 200, 1, 3],
  ['Ongole', 'Andhra Pradesh', 15.5, 80.05, 200, 1, 3],
  ['Srikakulam', 'Andhra Pradesh', 18.3, 83.9, 150, 1, 3],
  ['Port Blair', 'Andaman and Nicobar', 11.62, 92.73, 100, 1, 1],
  ['Shillong', 'Meghalaya', 25.58, 91.89, 350, 0, 2],
  ['Agartala', 'Tripura', 23.83, 91.29, 500, 0, 2],
  ['Imphal', 'Manipur', 24.82, 93.94, 400, 0, 2],
  ['Aizawl', 'Mizoram', 23.73, 92.72, 300, 0, 3],
  ['Dibrugarh', 'Assam', 27.47, 94.91, 150, 0, 3],
  ['Siliguri', 'West Bengal', 26.73, 88.4, 700, 0, 3],
  ['Gangtok', 'Sikkim', 27.33, 88.61, 100, 0, 3],
  ['Dehradun', 'Uttarakhand', 30.32, 78.03, 700, 0, 2],
  ['Shimla', 'Himachal Pradesh', 31.1, 77.17, 200, 0, 2],
  ['Jammu', 'Jammu and Kashmir', 32.73, 74.86, 650, 0, 3],
  ['Leh', 'Ladakh', 34.15, 77.58, 30, 0, 2],
  ['Gorakhpur', 'Uttar Pradesh', 26.76, 83.37, 700, 0, 3],
  ['Prayagraj', 'Uttar Pradesh', 25.44, 81.85, 1200, 0, 3],
  ['Gwalior', 'Madhya Pradesh', 26.22, 78.18, 1100, 0, 3],
  ['Jabalpur', 'Madhya Pradesh', 23.18, 79.95, 1300, 0, 2],
  ['Aurangabad', 'Maharashtra', 19.88, 75.34, 1200, 0, 3],
  ['Nashik', 'Maharashtra', 19.99, 73.79, 1600, 0, 3],
  ['Solapur', 'Maharashtra', 17.66, 75.91, 1000, 0, 3],
  ['Kolhapur', 'Maharashtra', 16.7, 74.24, 600, 0, 3],
  ['Hubballi', 'Karnataka', 15.36, 75.12, 950, 0, 3],
  ['Mysuru', 'Karnataka', 12.3, 76.64, 1000, 0, 3],
  ['Tirupati', 'Andhra Pradesh', 13.63, 79.42, 500, 0, 3],
  ['Kurnool', 'Andhra Pradesh', 15.83, 78.04, 500, 0, 3],
  ['Warangal', 'Telangana', 17.97, 79.59, 800, 0, 3],
  ['Bikaner', 'Rajasthan', 28.02, 73.31, 650, 0, 2],
  ['Udaipur', 'Rajasthan', 24.59, 73.71, 500, 0, 3],
  ['Kota', 'Rajasthan', 25.21, 75.86, 1000, 0, 3],
  ['Jaisalmer', 'Rajasthan', 26.92, 70.91, 70, 0, 2],
  ['Barmer', 'Rajasthan', 25.75, 71.39, 100, 0, 3],
  ['Sri Ganganagar', 'Rajasthan', 29.9, 73.88, 250, 0, 3],
  ['Hisar', 'Haryana', 29.15, 75.72, 300, 0, 3],
  ['Ludhiana', 'Punjab', 30.9, 75.86, 1600, 0, 3],
  ['Meerut', 'Uttar Pradesh', 28.98, 77.71, 1400, 0, 3],
  ['Bareilly', 'Uttar Pradesh', 28.37, 79.43, 900, 0, 3],
  ['Jhansi', 'Uttar Pradesh', 25.45, 78.57, 500, 0, 3],
  ['Sambalpur', 'Odisha', 21.47, 83.97, 300, 0, 3],
  ['Jamshedpur', 'Jharkhand', 22.8, 86.2, 1300, 0, 3],
  ['Dhanbad', 'Jharkhand', 23.8, 86.43, 1200, 0, 3],
  ['Gaya', 'Bihar', 24.79, 85.0, 500, 0, 3],
  ['Bhagalpur', 'Bihar', 25.24, 86.98, 400, 0, 3],
  ['Asansol', 'West Bengal', 23.68, 86.99, 1200, 0, 3],
  ['Amravati', 'Maharashtra', 20.93, 77.75, 650, 0, 3],
  ['Chandrapur', 'Maharashtra', 19.96, 79.3, 400, 0, 3],
  ['Jagdalpur', 'Chhattisgarh', 19.08, 82.03, 200, 0, 3],
  ['Bilaspur', 'Chhattisgarh', 22.08, 82.15, 450, 0, 3],
  ['Thanjavur', 'Tamil Nadu', 10.79, 79.14, 250, 0, 3],
  ['Salem', 'Tamil Nadu', 11.66, 78.15, 900, 0, 3],
  ['Tirunelveli', 'Tamil Nadu', 8.71, 77.76, 500, 0, 3],
  ['Rameswaram', 'Tamil Nadu', 9.29, 79.31, 40, 1, 3],
  ['Dhaka', 'Dhaka', 23.81, 90.41, 22000, 0, 1, 'Bangladesh'],
  ['Chattogram', 'Chattogram', 22.36, 91.78, 5000, 1, 2, 'Bangladesh'],
  ["Cox's Bazar", 'Chattogram', 21.43, 92.0, 250, 1, 3, 'Bangladesh'],
  ['Khulna', 'Khulna', 22.85, 89.54, 1000, 0, 3, 'Bangladesh'],
  ['Sittwe', 'Rakhine', 20.15, 92.9, 150, 1, 3, 'Myanmar'],
  ['Yangon', 'Yangon', 16.84, 96.17, 5600, 1, 1, 'Myanmar'],
  ['Karachi', 'Sindh', 24.86, 67.01, 17000, 1, 1, 'Pakistan'],
  ['Lahore', 'Punjab (PK)', 31.55, 74.34, 13000, 0, 2, 'Pakistan'],
  ['Gwadar', 'Balochistan', 25.13, 62.32, 90, 1, 3, 'Pakistan'],
  ['Muscat', 'Muscat', 23.59, 58.41, 1600, 1, 1, 'Oman'],
  ['Salalah', 'Dhofar', 17.02, 54.09, 330, 1, 2, 'Oman'],
  ['Colombo', 'Western', 6.93, 79.86, 5600, 1, 1, 'Sri Lanka'],
  ['Jaffna', 'Northern', 9.66, 80.01, 90, 1, 3, 'Sri Lanka'],
  ['Trincomalee', 'Eastern', 8.59, 81.21, 100, 1, 3, 'Sri Lanka'],
  ['Male', 'Male', 4.18, 73.51, 250, 1, 2, 'Maldives'],
  ['Kathmandu', 'Bagmati', 27.72, 85.32, 3000, 0, 1, 'Nepal'],
];

export const CITIES: City[] = ROWS.map(([name, state, lat, lon, pop, coastal, tier, country]) => ({
  id: name.toLowerCase().replace(/[^a-z]+/g, '-'),
  name,
  state,
  lat,
  lon,
  pop,
  coastal: coastal === 1,
  tier,
  country: country ?? 'India',
}));

export const CITY_BY_ID = new Map(CITIES.map((c) => [c.id, c]));

// ---------------------------------------------------------------------------
// Ordered coastline, Yemen to Myanmar, for landfall statistics.

export interface CoastPoint {
  name: string;
  region: string;
  lon: number;
  lat: number;
}

const COAST_ROWS: [string, string, number, number][] = [
  ['Al Ghaydah', 'Yemen', 52.17, 16.2],
  ['Salalah', 'Oman', 54.09, 17.0],
  ['Duqm', 'Oman', 57.7, 19.67],
  ['Masirah', 'Oman', 58.4, 20.4],
  ['Ras al Hadd', 'Oman', 59.8, 22.53],
  ['Muscat', 'Oman', 58.55, 23.62],
  ['Jask', 'Iran', 57.77, 25.64],
  ['Chabahar', 'Iran', 60.62, 25.29],
  ['Gwadar', 'Pakistan', 62.33, 25.12],
  ['Ormara', 'Pakistan', 64.64, 25.21],
  ['Karachi', 'Pakistan', 66.98, 24.82],
  ['Keti Bandar', 'Pakistan', 67.45, 24.14],
  ['Koteshwar', 'Gujarat', 68.53, 23.68],
  ['Jakhau', 'Gujarat', 68.72, 23.22],
  ['Mandvi', 'Gujarat', 69.35, 22.83],
  ['Dwarka', 'Gujarat', 68.97, 22.24],
  ['Porbandar', 'Gujarat', 69.61, 21.64],
  ['Veraval', 'Gujarat', 70.37, 20.91],
  ['Diu', 'Gujarat', 70.98, 20.71],
  ['Surat', 'Gujarat', 72.65, 21.1],
  ['Daman', 'Gujarat', 72.83, 20.41],
  ['Dahanu', 'Maharashtra', 72.71, 19.97],
  ['Mumbai', 'Maharashtra', 72.82, 18.93],
  ['Alibag', 'Maharashtra', 72.87, 18.64],
  ['Shrivardhan', 'Maharashtra', 73.02, 18.04],
  ['Ratnagiri', 'Maharashtra', 73.28, 16.99],
  ['Malvan', 'Maharashtra', 73.47, 16.06],
  ['Panaji', 'Goa', 73.8, 15.49],
  ['Karwar', 'Karnataka', 74.11, 14.81],
  ['Bhatkal', 'Karnataka', 74.55, 13.99],
  ['Udupi', 'Karnataka', 74.7, 13.35],
  ['Mangaluru', 'Karnataka', 74.82, 12.87],
  ['Kasaragod', 'Kerala', 74.98, 12.5],
  ['Kannur', 'Kerala', 75.35, 11.87],
  ['Kozhikode', 'Kerala', 75.77, 11.25],
  ['Ponnani', 'Kerala', 75.92, 10.77],
  ['Kochi', 'Kerala', 76.24, 9.97],
  ['Alappuzha', 'Kerala', 76.32, 9.49],
  ['Kollam', 'Kerala', 76.57, 8.88],
  ['Thiruvananthapuram', 'Kerala', 76.93, 8.48],
  ['Kanyakumari', 'Tamil Nadu', 77.54, 8.08],
  ['Thoothukudi', 'Tamil Nadu', 78.17, 8.78],
  ['Rameswaram', 'Tamil Nadu', 79.31, 9.28],
  ['Vedaranyam', 'Tamil Nadu', 79.86, 10.3],
  ['Nagapattinam', 'Tamil Nadu', 79.85, 10.77],
  ['Karaikal', 'Puducherry', 79.85, 10.92],
  ['Cuddalore', 'Tamil Nadu', 79.78, 11.74],
  ['Puducherry', 'Puducherry', 79.84, 11.93],
  ['Mamallapuram', 'Tamil Nadu', 80.19, 12.62],
  ['Chennai', 'Tamil Nadu', 80.29, 13.08],
  ['Pulicat', 'Tamil Nadu', 80.32, 13.42],
  ['Sriharikota', 'Andhra Pradesh', 80.24, 13.7],
  ['Krishnapatnam', 'Andhra Pradesh', 80.13, 14.25],
  ['Kavali', 'Andhra Pradesh', 80.1, 14.92],
  ['Ongole', 'Andhra Pradesh', 80.2, 15.45],
  ['Bapatla', 'Andhra Pradesh', 80.5, 15.85],
  ['Machilipatnam', 'Andhra Pradesh', 81.17, 16.17],
  ['Narsapur', 'Andhra Pradesh', 81.7, 16.33],
  ['Kakinada', 'Andhra Pradesh', 82.28, 16.95],
  ['Tuni', 'Andhra Pradesh', 82.65, 17.3],
  ['Visakhapatnam', 'Andhra Pradesh', 83.3, 17.68],
  ['Kalingapatnam', 'Andhra Pradesh', 84.12, 18.33],
  ['Gopalpur', 'Odisha', 84.91, 19.27],
  ['Chilika', 'Odisha', 85.45, 19.65],
  ['Puri', 'Odisha', 85.83, 19.79],
  ['Paradip', 'Odisha', 86.67, 20.27],
  ['Dhamra', 'Odisha', 86.95, 20.79],
  ['Chandipur', 'Odisha', 87.03, 21.47],
  ['Digha', 'West Bengal', 87.51, 21.63],
  ['Sagar Island', 'West Bengal', 88.07, 21.65],
  ['Raimangal', 'West Bengal', 89.1, 21.65],
  ['Mongla', 'Bangladesh', 89.6, 21.85],
  ['Kuakata', 'Bangladesh', 90.12, 21.82],
  ['Meghna estuary', 'Bangladesh', 91.0, 22.4],
  ['Chattogram', 'Bangladesh', 91.8, 22.3],
  ["Cox's Bazar", 'Bangladesh', 91.98, 21.43],
  ['Teknaf', 'Bangladesh', 92.3, 20.86],
  ['Sittwe', 'Myanmar', 92.9, 20.14],
  ['Kyaukpyu', 'Myanmar', 93.55, 19.43],
  ['Thandwe', 'Myanmar', 94.35, 18.46],
  ['Gwa', 'Myanmar', 94.58, 17.59],
  ['Cape Negrais', 'Myanmar', 94.2, 16.02],
];

export const COAST: CoastPoint[] = COAST_ROWS.map(([name, region, lon, lat]) => ({ name, region, lon, lat }));
export const COAST_LINE: [number, number][] = COAST.map((c) => [c.lon, c.lat]);

/** Cumulative arc length (km) at every coast waypoint. */
export const COAST_ARC: number[] = (() => {
  const out = [0];
  for (let i = 1; i < COAST.length; i++) {
    out.push(out[i - 1] + distKm(COAST[i - 1].lon, COAST[i - 1].lat, COAST[i].lon, COAST[i].lat));
  }
  return out;
})();
export const COAST_LENGTH = COAST_ARC[COAST_ARC.length - 1];

/** Contiguous coast segments by region, for the landfall ribbon. */
export const COAST_SEGMENTS: { region: string; from: number; to: number }[] = (() => {
  const segs: { region: string; from: number; to: number }[] = [];
  for (let i = 0; i < COAST.length; i++) {
    const r = COAST[i].region;
    const start = i === 0 ? 0 : (COAST_ARC[i - 1] + COAST_ARC[i]) / 2;
    const end = i === COAST.length - 1 ? COAST_LENGTH : (COAST_ARC[i] + COAST_ARC[i + 1]) / 2;
    const last = segs[segs.length - 1];
    if (last && last.region === r) last.to = end;
    else segs.push({ region: r, from: start, to: end });
  }
  return segs;
})();

export function coastPosition(lon: number, lat: number): { arcKm: number; dist: number; nearest: CoastPoint } {
  const r = nearestOnPolyline(lon, lat, COAST_LINE);
  const near = r.t < 0.5 ? COAST[r.index] : COAST[r.index + 1];
  return { arcKm: r.arcKm, dist: r.dist, nearest: near };
}

export function coastPointAt(arcKm: number): CoastPoint {
  let best = 0;
  for (let i = 1; i < COAST_ARC.length; i++) if (Math.abs(COAST_ARC[i] - arcKm) < Math.abs(COAST_ARC[best] - arcKm)) best = i;
  return COAST[best];
}

export function coastRegionAt(arcKm: number): string {
  for (const s of COAST_SEGMENTS) if (arcKm >= s.from && arcKm <= s.to) return s.region;
  return COAST_SEGMENTS[COAST_SEGMENTS.length - 1].region;
}

// ---------------------------------------------------------------------------
// Sea areas in the style of IMD bulletins.

export function seaArea(lon: number, lat: number): string {
  if (lat < 4.5) return 'the equatorial Indian Ocean';
  if (lon >= 78.0 && lon <= 79.6 && lat >= 8.0 && lat <= 9.6) return 'the Gulf of Mannar';
  if (lon >= 76.0 && lon < 78.0 && lat < 8.2) return 'the Comorin area';
  if (lon >= 78.3) {
    // Bay of Bengal and Andaman Sea
    if (lon >= 92.6 && lat < 17.5) return lat < 10.5 ? 'the south Andaman Sea' : 'the north Andaman Sea';
    if (lat >= 19.6) return 'the north Bay of Bengal';
    const ew = lat >= 13 ? (lon < 86.8 ? 'west' : 'east') : lon < 85.0 ? 'west' : 'east';
    if (lat >= 17.0) return ew === 'west' ? 'the northwest Bay of Bengal' : 'the northeast Bay of Bengal';
    if (lat >= 13.0) return ew === 'west' ? 'the westcentral Bay of Bengal' : 'the eastcentral Bay of Bengal';
    return ew === 'west' ? 'the southwest Bay of Bengal' : 'the southeast Bay of Bengal';
  }
  // Arabian Sea
  if (lat >= 22.5 && lon < 61.5) return 'the Gulf of Oman';
  if (lon >= 71.0 && lon <= 74.5 && lat >= 8.0 && lat <= 12.6) return 'the Lakshadweep area';
  if (lat >= 18.0) return lon >= 66.0 ? 'the northeast Arabian Sea' : 'the northwest Arabian Sea';
  if (lat >= 13.0) return lon >= 67.0 ? 'the eastcentral Arabian Sea' : 'the westcentral Arabian Sea';
  return lon >= 68.0 ? 'the southeast Arabian Sea' : 'the southwest Arabian Sea';
}

export type Basin = 'BOB' | 'ARB' | 'LAND';

export function basinOf(lon: number, lat: number, overLand: boolean): Basin {
  if (overLand) return 'LAND';
  if (lon >= 78.3 && lat >= 4.5) return 'BOB';
  if (lon < 78.3) return 'ARB';
  return 'BOB';
}

export function nearestCity(
  lon: number,
  lat: number,
  filter: (c: City) => boolean = () => true,
): { city: City; km: number; bearingFromCity: number } {
  let best: City = CITIES[0];
  let bestD = Infinity;
  for (const c of CITIES) {
    if (!filter(c)) continue;
    const d = distKm(lon, lat, c.lon, c.lat);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return { city: best, km: bestD, bearingFromCity: bearingDeg(best.lon, best.lat, lon, lat) };
}

/** "about 420 km southeast of Visakhapatnam", rounded the way bulletins round. */
export function relativeTo(lon: number, lat: number, city: City): string {
  const km = distKm(lon, lat, city.lon, city.lat);
  const b = bearingDeg(city.lon, city.lat, lon, lat);
  if (km < 25) return `near ${city.name}`;
  const rounded = km < 100 ? Math.round(km / 5) * 5 : Math.round(km / 10) * 10;
  return `about ${rounded} km ${compassWords(b)} of ${city.name}`;
}

/** Prefer large or coastal reference cities so phrases read like a bulletin. */
export function referenceCities(lon: number, lat: number, overSea: boolean, n = 2): City[] {
  const scored = CITIES.filter((c) => c.country === 'India' || c.tier === 1)
    .map((c) => {
      const d = distKm(lon, lat, c.lon, c.lat);
      const weight = (c.tier === 1 ? 0.75 : c.tier === 2 ? 0.9 : 1.05) * (overSea && !c.coastal ? 1.5 : 1);
      return { c, s: d * weight };
    })
    .sort((a, b) => a.s - b.s);
  const out: City[] = [];
  for (const { c } of scored) {
    if (out.some((o) => distKm(o.lon, o.lat, c.lon, c.lat) < 120)) continue;
    out.push(c);
    if (out.length >= n) break;
  }
  return out;
}
