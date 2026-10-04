import { representativeDate, type SeasonId } from '../engine/climate';

// Hand-picked worlds that show off particular behaviour (found by scanning
// seeds). Any seed works; these are good starting points for a demonstration.
const at = (season: SeasonId) => representativeDate(season, 2026);

export const SHOWCASE: { label: string; season: SeasonId; seed: number; analysis: number }[] = [
  { label: 'Bay cyclone landfall, remnant regenerates in the Arabian Sea', season: 'postmonsoon', seed: 20261004, analysis: Date.UTC(2026, 9, 4) },
  { label: 'Extremely severe cyclone strikes the Tamil Nadu coast', season: 'postmonsoon', seed: 20260307, analysis: at('postmonsoon') },
  { label: 'Twin cyclones in both seas, with a heat wave inland', season: 'premonsoon', seed: 20262083, analysis: at('premonsoon') },
  { label: 'Monsoon depression crosses Odisha, remnant revives at sea', season: 'monsoon', seed: 20261602, analysis: at('monsoon') },
  { label: 'Back-to-back western disturbances and cold waves', season: 'winter', seed: 20261306, analysis: at('winter') },
];
