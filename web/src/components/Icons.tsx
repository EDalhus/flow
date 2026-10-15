// Strek-ikoner fra designet. Dekorative ikoner er aria-hidden; knappene har egen aria-label.
import type { CSSProperties, ReactNode } from 'react';

type P = { size?: number; style?: CSSProperties; strokeWidth?: number };

function Stroke({ size = 18, style, strokeWidth = 1.8, children }: P & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      {children}
    </svg>
  );
}

export const Logo = ({ size = 34 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 34 34" fill="none" stroke="#80EFDE" strokeWidth="2.4" strokeLinecap="round" role="img" aria-label="Flow">
    <path d="M4 22c4-4 8-4 13 0s9 4 13 0" />
    <path d="M4 15c4-4 8-4 13 0s9 4 13 0" opacity=".6" />
    <path d="M4 8c4-4 8-4 13 0s9 4 13 0" opacity=".3" />
  </svg>
);

export const Search = (p: P) => <Stroke {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Stroke>;
export const Bell = (p: P) => <Stroke {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></Stroke>;
export const Close = (p: P) => <Stroke {...p}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Stroke>;
export const Plus = (p: P) => <Stroke {...p}><path d="M12 5v14M5 12h14" /></Stroke>;
export const Minus = (p: P) => <Stroke {...p}><path d="M5 12h14" /></Stroke>;
export const Target = (p: P) => <Stroke {...p}><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></Stroke>;
export const ArrowUpRight = (p: P) => <Stroke {...p}><path d="M7 17 17 7" /><path d="M8 7h9v9" /></Stroke>;
export const ArrowRight = (p: P) => <Stroke {...p}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></Stroke>;
export const ArrowLeft = (p: P) => <Stroke {...p}><path d="M19 12H5" /><path d="m11 18-6-6 6-6" /></Stroke>;
export const Check = (p: P) => <Stroke {...p}><path d="M20 6 9 17l-5-5" /></Stroke>;
export const Chevron = (p: P) => <Stroke {...p}><path d="m6 9 6 6 6-6" /></Stroke>;
export const Clock = (p: P) => <Stroke {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Stroke>;
export const Flag = (p: P) => <Stroke strokeWidth={2.4} {...p}><path d="M4 22V4" /><path d="M4 4h13l-2 4 2 4H4" /></Stroke>;
export const Anchor = (p: P) => <Stroke strokeWidth={2.6} {...p}><circle cx="12" cy="5" r="3" /><path d="M12 8v14" /><path d="M5 12H2a10 10 0 0 0 20 0h-3" /></Stroke>;
export const TrendUp = (p: P) => <Stroke {...p}><path d="M3 17 9 11l4 4 8-8" /><path d="M14 7h7v7" /></Stroke>;
export const Sparkle = (p: P) => <Stroke {...p}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2" /></Stroke>;
// Ikonmeny (venstre)
export const Globe = (p: P) => <Stroke {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" /></Stroke>;
export const CalendarList = (p: P) => <Stroke {...p}><rect x="3" y="4.5" width="18" height="16" rx="3" /><path d="M8 2.5v4M16 2.5v4M3 9.5h18M7.5 14h4M7.5 17h7" /></Stroke>;
export const Ship = (p: P) => <Stroke {...p}><path d="M3 14h18l-2.5 5.5H5.5z" /><path d="M6 14V9h12v5" /><path d="M10 9V5h4v4" /><path d="M2 21.5c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 2-1 4-1" /></Stroke>;
export const Book = (p: P) => <Stroke {...p}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" /><path d="m9 10 2 2 4-4" /></Stroke>;
export const PieChart = (p: P) => <Stroke {...p}><path d="M21 12A9 9 0 1 1 12 3v9z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15z" /></Stroke>;
export const Users = (p: P) => <Stroke {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.5a6.5 6.5 0 0 1 3.5 5.5" /></Stroke>;

export const Truck = (p: P) => <Stroke {...p}><path d="M2 6h11v10H2z" /><path d="M13 9h4.5l3.5 3.5V16h-8" /><circle cx="6.5" cy="17.5" r="2" /><circle cx="17" cy="17.5" r="2" /></Stroke>;
export const BulkTruck = (p: P) => <Stroke {...p}><path d="M2 8l2 8h10l2-8z" /><path d="M16 11h3l3 3v2h-6" /><circle cx="6.5" cy="18" r="2" /><circle cx="18" cy="18" r="2" /><path d="M6 8l2-4h4l2 4" /></Stroke>;
export const Factory = (p: P) => <Stroke {...p}><path d="M2 21V10l6 4V10l6 4V5h4l2 16z" /><path d="M6 17h2M11 17h2M16 17h2" /></Stroke>;
export const Gauge = (p: P) => <Stroke {...p}><path d="M4 18a8 8 0 1 1 16 0" /><path d="m12 18 4-6" /></Stroke>;

export const Camera = (p: P) => (
  <Stroke {...p}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></Stroke>
);
export const Phone = (p: P) => (
  <Stroke {...p}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
  </Stroke>
);

export const Star = ({ size = 13, fill = '#F7B955' }: { size?: number; fill?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill={fill} />
  </svg>
);

export const Warning = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" fill="#E5484D" />
    <path d="M12 9v4M12 17h.01" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

/** Båtsymbol (pil) som roteres etter kurs. */
export const Vessel = ({ size = 16, fill, rotate = 0 }: { size?: number; fill: string; rotate?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" style={{ transform: `rotate(${rotate}deg)` }}>
    <path d="M10 1 17 18 10 14 3 18z" fill={fill} />
  </svg>
);
