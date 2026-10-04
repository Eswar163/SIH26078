import type { EventKind } from '../engine/detect';
import { catIndex } from '../engine/imd';
import { SymCold, SymCyclone, SymDepression, SymHeat, SymLow, SymRain, SymThunder, SymTrough } from './icons';

export function KindGlyph({ kind, cat, size = 14 }: { kind: EventKind; cat?: string; size?: number }) {
  const cls = `glyph glyph--${kind}`;
  if (kind === 'cyclone') {
    const ci = catIndex(cat ?? 'L');
    if (ci <= 1) return <SymLow size={size} className={cls} />;
    if (ci <= 3) return <SymDepression size={size} className={cls} />;
    return <SymCyclone size={size} filled={ci >= 6} className={cls} />;
  }
  if (kind === 'wd') return <SymTrough size={size} className={cls} />;
  if (kind === 'heat') return <SymHeat size={size} className={cls} />;
  if (kind === 'cold') return <SymCold size={size} className={cls} />;
  if (kind === 'storm') return <SymThunder size={size} className={cls} />;
  return <SymRain size={size} className={cls} />;
}

export function CatChip({ cat }: { cat: string }) {
  const ci = catIndex(cat);
  const level = ci >= 6 ? 3 : ci >= 4 ? 2 : ci >= 2 ? 1 : 0;
  return <span className={`chip chip--cat-${level}`}>{cat}</span>;
}

export const KIND_NAMES: Record<EventKind, string> = {
  cyclone: 'Cyclonic systems',
  wd: 'Western disturbances',
  heat: 'Heat waves',
  cold: 'Cold waves',
  rain: 'Heavy rain',
  storm: 'Thunderstorms',
};
