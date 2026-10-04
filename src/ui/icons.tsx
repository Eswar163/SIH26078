// Hand-drawn icon set (16px grid, 1.5 stroke) and meteorological symbols in
// the style of WMO synoptic chart notation.

import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: P) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconPlay = (p: P) => (
  <Svg {...p}>
    <path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconPause = (p: P) => (
  <Svg {...p}>
    <path d="M5.5 3.5v9M10.5 3.5v9" strokeWidth={2} />
  </Svg>
);
export const IconStepBack = (p: P) => (
  <Svg {...p}>
    <path d="M11 4 6 8l5 4M4.5 4v8" />
  </Svg>
);
export const IconStepFwd = (p: P) => (
  <Svg {...p}>
    <path d="m5 4 5 4-5 4M11.5 4v8" />
  </Svg>
);
export const IconLayers = (p: P) => (
  <Svg {...p}>
    <path d="m8 2.5 5.5 3L8 8.5l-5.5-3z" />
    <path d="m2.5 8.2 5.5 3 5.5-3M2.5 10.9l5.5 3 5.5-3" />
  </Svg>
);
export const IconSearch = (p: P) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="m10.2 10.2 3.3 3.3" />
  </Svg>
);
export const IconSun = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="2.75" />
    <path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1 1M11.4 11.4l1 1M3.6 12.4l1-1M11.4 4.6l1-1" />
  </Svg>
);
export const IconMoon = (p: P) => (
  <Svg {...p}>
    <path d="M12.8 9.6A5.25 5.25 0 0 1 6.4 3.2a5.25 5.25 0 1 0 6.4 6.4z" />
  </Svg>
);
export const IconEye = (p: P) => (
  <Svg {...p}>
    <path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z" />
    <circle cx="8" cy="8" r="1.9" />
  </Svg>
);
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M8 3.5v9M3.5 8h9" />
  </Svg>
);
export const IconMinus = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 8h9" />
  </Svg>
);
export const IconTarget = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="4.5" />
    <path d="M8 1.75v2.5M8 11.75v2.5M1.75 8h2.5M11.75 8h2.5" />
  </Svg>
);
export const IconCopy = (p: P) => (
  <Svg {...p}>
    <rect x="5.25" y="5.25" width="8" height="8" rx="1.5" />
    <path d="M10.75 5V3.75a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1H5" />
  </Svg>
);
export const IconPrint = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 6V2.75h7V6M4.5 11.5h-1.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1h-1.5" />
    <path d="M4.5 9.5h7v3.75h-7z" />
  </Svg>
);
export const IconDownload = (p: P) => (
  <Svg {...p}>
    <path d="M8 2.75v7.5M4.75 7.25 8 10.5l3.25-3.25M3 13.25h10" />
  </Svg>
);
export const IconChevron = (p: P & { dir?: 'down' | 'right' | 'left' | 'up' }) => {
  const { dir = 'down', ...rest } = p;
  const d = { down: 'm4.5 6.5 3.5 3.5 3.5-3.5', up: 'm4.5 9.5 3.5-3.5 3.5 3.5', right: 'm6.5 4.5 3.5 3.5-3.5 3.5', left: 'm9.5 4.5-3.5 3.5 3.5 3.5' }[dir];
  return (
    <Svg {...rest}>
      <path d={d} />
    </Svg>
  );
};
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Svg>
);
export const IconShuffle = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 4.5h2.2c1.4 0 2.2.6 3 1.9l1.6 3.2c.7 1.3 1.6 1.9 3 1.9h1.2M11.8 9.6l1.7 1.9-1.7 1.9M2.5 11.5h2.2c.9 0 1.5-.3 2-.9M9.3 5.4c.5-.6 1.1-.9 2-.9h1.7M11.8 2.6l1.7 1.9-1.7 1.9" />
  </Svg>
);
export const IconInfo = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.25v3.75M8 5v.25" />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="m3.5 8.5 3 3 6-7" />
  </Svg>
);
export const IconCommand = (p: P) => (
  <Svg {...p}>
    <path d="M6 6V4.5A1.5 1.5 0 1 0 4.5 6H6zm0 0h4m-4 0v4m4-4V4.5A1.5 1.5 0 1 1 11.5 6H10zm0 0v4m0 0h1.5A1.5 1.5 0 1 1 10 11.5V10zm0 0H6m0 0v1.5A1.5 1.5 0 1 1 4.5 10H6z" />
  </Svg>
);
export const IconClock = (p: P) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.75V8l2.25 1.5" />
  </Svg>
);
export const IconBranch = (p: P) => (
  <Svg {...p}>
    <circle cx="4" cy="3.75" r="1.5" />
    <circle cx="4" cy="12.25" r="1.5" />
    <circle cx="12" cy="6" r="1.5" />
    <path d="M4 5.25v5.5M12 7.5c0 2.5-2 3-4 3.4-1.6.3-3 .9-3.6 1.6" />
  </Svg>
);
export const IconSend = (p: P) => (
  <Svg {...p}>
    <path d="M2.75 8h8.5M8 4.75 11.25 8 8 11.25" />
  </Svg>
);

// ---------------------------------------------------------------- symbols

interface SymProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

/** WMO tropical cyclone symbol. `filled` for very severe and above. */
export function SymCyclone({ size = 16, filled = false, ...rest }: SymProps & { filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...rest}>
      <path d="M8 4.2C8.7 2.4 10.4 1.4 12.6 1.6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      <path d="M8 11.8C7.3 13.6 5.6 14.6 3.4 14.4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      <circle cx="8" cy="8" r="3.4" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.6} />
    </svg>
  );
}

export function SymDepression({ size = 16, ...rest }: SymProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...rest}>
      <circle cx="8" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth={1.6} />
    </svg>
  );
}

export function SymLow({ size = 16, ...rest }: SymProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...rest}>
      <path d="M5 3v10h6.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SymTrough({ size = 16, ...rest }: SymProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...rest}>
      <path d="M5 1.8 7 5.5M8.2 7.6l1.6 3M11 12.7l1 1.8" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

export function SymThunder({ size = 16, ...rest }: SymProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...rest}>
      <path d="M3 3.5h8.5L7.5 9h4.5l-5 5.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SymRain({ size = 16, ...rest }: SymProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...rest}>
      <circle cx="5" cy="5.5" r="1.7" fill="currentColor" />
      <circle cx="11" cy="5.5" r="1.7" fill="currentColor" />
      <circle cx="8" cy="10.5" r="1.7" fill="currentColor" />
    </svg>
  );
}

export function SymHeat({ size = 16, ...rest }: SymProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...rest}>
      <path d="M2.5 13.5h11" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      <path d="M3.5 10.5c1.3-1.4 2.6-1.4 3.9 0s2.6 1.4 3.9 0M3.5 7c1.3-1.4 2.6-1.4 3.9 0s2.6 1.4 3.9 0M3.5 3.5c1.3-1.4 2.6-1.4 3.9 0s2.6 1.4 3.9 0" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
    </svg>
  );
}

export function SymCold({ size = 16, ...rest }: SymProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...rest}>
      <path d="M8 2v12M2.8 5l10.4 6M2.8 11l10.4-6" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

/** Trikaal mark: the cyclone symbol inside a thin ring of past, present and future. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.6a9.4 9.4 0 0 1 8.9 6.4" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" opacity={0.45} />
      <path d="M21.2 12.8a9.4 9.4 0 0 1-5.6 7.9" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
      <path d="M11.2 21.4a9.4 9.4 0 0 1-8.5-8" fill="none" stroke="var(--track)" strokeWidth={1.3} strokeLinecap="round" strokeDasharray="2 2.2" />
      <path d="M12 9.1c.8-2 2.8-3.1 5.2-2.9" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />
      <path d="M12 14.9c-.8 2-2.8 3.1-5.2 2.9" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />
      <circle cx="12" cy="12" r="2.9" fill="none" stroke="currentColor" strokeWidth={1.7} />
    </svg>
  );
}
