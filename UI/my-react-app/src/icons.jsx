// Small inline SVG icons (no icon library needed, works offline)
const base = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };

export const IconSpark = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5" />
  </svg>
);
export const IconPlus = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
);
export const IconClip = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M21.4 11.1l-8.5 8.5a5 5 0 01-7.1-7.1l8.5-8.5a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.8-7.8" />
  </svg>
);
export const IconArrowUp = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} strokeWidth={2.4} aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
);
export const IconFile = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" /><path d="M14 3v6h6" />
  </svg>
);
export const IconTrash = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </svg>
);
export const IconLoader = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} className="spin" aria-hidden="true"><path d="M21 12a9 9 0 11-6.2-8.6" /></svg>
);
