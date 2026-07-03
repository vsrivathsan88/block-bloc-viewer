// Minimal inline SVG icon set. Every icon button is icon-only with a
// tooltip (title attr) — words live in tooltips, not on the screen.

const S = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const IconPlay = () => (
  <svg {...S}><polygon points="6 4 20 12 6 20" fill="currentColor" stroke="none" /></svg>
);
export const IconPause = () => (
  <svg {...S}><rect x="6" y="5" width="4" height="14" fill="currentColor" stroke="none" /><rect x="14" y="5" width="4" height="14" fill="currentColor" stroke="none" /></svg>
);
export const IconPrev = () => (
  <svg {...S}><polygon points="18 4 8 12 18 20" fill="currentColor" stroke="none" /><rect x="5" y="4" width="2.5" height="16" fill="currentColor" stroke="none" /></svg>
);
export const IconNext = () => (
  <svg {...S}><polygon points="6 4 16 12 6 20" fill="currentColor" stroke="none" /><rect x="16.5" y="4" width="2.5" height="16" fill="currentColor" stroke="none" /></svg>
);
export const IconClose = () => (
  <svg {...S}><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
);
export const IconCheck = () => (
  <svg {...S}><polyline points="4 13 10 19 20 6" /></svg>
);
export const IconTrash = () => (
  <svg {...S}><path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M6 7l1 13h10l1-13" /></svg>
);
export const IconPencil = () => (
  <svg {...S}><path d="M4 20l1-4L16 5l3 3L8 19l-4 1z" /></svg>
);
export const IconArrow = () => (
  <svg {...S}><path d="M4 18 C8 16 12 12 17 8" /><path d="M12 7l5 1 1 5" /></svg>
);
export const IconUndo = () => (
  <svg {...S}><path d="M8 6L4 10l4 4" /><path d="M4 10h10a6 6 0 0 1 0 12h-3" /></svg>
);
export const IconBolt = () => (
  <svg {...S}><polygon points="13 2 5 14 11 14 10 22 19 9 13 9" fill="currentColor" stroke="none" /></svg>
);
export const IconPerson = () => (
  <svg {...S}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" /></svg>
);
export const IconPersonPlus = () => (
  <svg {...S}><circle cx="10" cy="8" r="4" /><path d="M3 21c1.3-3.6 4.3-5.5 7-5.5s5.7 1.9 7 5.5" /><line x1="19" y1="6" x2="19" y2="12" /><line x1="16" y1="9" x2="22" y2="9" /></svg>
);
export const IconGear = () => (
  <svg {...S}><circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4L5.3 5.3" /></svg>
);
export const IconDots = () => (
  <svg {...S}><circle cx="5" cy="12" r="1.8" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.8" fill="currentColor" stroke="none" /></svg>
);
export const IconMap = () => (
  // floor plan: room outline + camera dot with view wedge
  <svg {...S}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" />
    <path d="M9 20.5V13h-5.5" />
    <circle cx="14.5" cy="14.5" r="1.6" fill="currentColor" stroke="none" />
    <path d="M14.5 12.6l-2.3-3.4M14.5 12.6l2.3-3.4" strokeWidth="1.5" />
  </svg>
);
export const IconCameraRig = () => (
  <svg {...S}><rect x="3" y="8" width="12" height="10" rx="2" /><polygon points="15 11 21 8 21 18 15 15" fill="currentColor" stroke="none" /></svg>
);
export const IconPrint = () => (
  <svg {...S}><path d="M7 9V3h10v6" /><rect x="4" y="9" width="16" height="8" rx="1" /><rect x="7" y="14" width="10" height="7" /></svg>
);
export const IconDownload = () => (
  <svg {...S}><path d="M12 3v12" /><polyline points="6 11 12 17 18 11" /><path d="M4 21h16" /></svg>
);
export const IconUpload = () => (
  <svg {...S}><path d="M12 21V9" /><polyline points="6 13 12 7 18 13" /><path d="M4 3h16" /></svg>
);
export const IconRevert = () => (
  <svg {...S}><path d="M4 5v6h6" /><path d="M4.5 11A8 8 0 1 1 7 17.7" /></svg>
);
export const IconBoard = () => (
  <svg {...S}><rect x="3" y="4" width="8" height="7" rx="1" /><rect x="13" y="4" width="8" height="7" rx="1" /><rect x="3" y="14" width="8" height="7" rx="1" /><rect x="13" y="14" width="8" height="7" rx="1" /></svg>
);
export const IconStage = () => (
  // clapperboard
  <svg {...S}>
    <path d="M20.2 6.6L4.8 10.7 4 7.8a1 1 0 0 1 .7-1.2l13.5-3.6a1 1 0 0 1 1.2.7l.8 2.9z" />
    <path d="M4.8 10.7h15.7v8.3a1 1 0 0 1-1 1H5.8a1 1 0 0 1-1-1v-8.3z" />
    <path d="M8.6 6.9l1.6 2.6M13.4 5.6l1.6 2.6" />
  </svg>
);
export const IconBox = () => (
  <svg {...S}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M4 7.5l8 4.5 8-4.5" /><path d="M12 12v9" /></svg>
);
export const IconShutter = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
  </svg>
);
