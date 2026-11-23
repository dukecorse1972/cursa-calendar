/**
 * Crisp stroke SVG icons for the Cursa Grades Simulator.
 * Minimal, consistent 1.75px stroke weight matching modern Linear / Apple / Google Workspace aesthetics.
 */

function svg(body: string, size: number = 15, extraClass: string = ''): string {
  const cls = extraClass ? ` class="${extraClass}"` : '';
  return `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export const GRADES_ICONS = {
  sparkles: (size = 15) =>
    svg(
      `<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 3v4M21 5h-4M5 17v4M7 19H3"/>`,
      size
    ),
  target: (size = 15) =>
    svg(`<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>`, size),
  sliders: (size = 15) =>
    svg(`<line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2" fill="currentColor"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="2" fill="currentColor"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="11" cy="18" r="2" fill="currentColor"/>`, size),
  shield: (size = 14) =>
    svg(`<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`, size),
  shieldCheck: (size = 14) =>
    svg(`<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>`, size),
  shieldAlert: (size = 14) =>
    svg(`<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>`, size),
  plus: (size = 14) =>
    svg(`<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`, size),
  trash: (size = 14) =>
    svg(`<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>`, size),
  x: (size = 13) =>
    svg(`<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`, size),
  check: (size = 14) =>
    svg(`<polyline points="20 6 9 17 4 12"/>`, size),
  chevronDown: (size = 14) =>
    svg(`<polyline points="6 9 12 15 18 9"/>`, size),
  calendar: (size = 13) =>
    svg(`<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`, size),
  link: (size = 13) =>
    svg(`<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`, size),
  layers: (size = 15) =>
    svg(`<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>`, size),
  folder: (size = 14) =>
    svg(`<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>`, size),
  grid: (size = 14) =>
    svg(`<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>`, size),
  graduationCap: (size = 15) =>
    svg(`<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>`, size),
  flask: (size = 13) =>
    svg(`<path d="M9 3h6M10 3v5.4L4.6 17.5A2 2 0 0 0 6.3 20.5h11.4a2 2 0 0 0 1.7-3L14 8.4V3"/>`, size),
  rotateCcw: (size = 13) =>
    svg(`<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>`, size),
  scale: (size = 14) =>
    svg(`<path d="M12 3v18M5 7h14M5 7l-2 7h4l-2-7zM19 7l-2 7h4l-2-7z"/>`, size),
  send: (size = 15) =>
    svg(`<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>`, size),
  alertTriangle: (size = 14) =>
    svg(`<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`, size),
  bookOpen: (size = 16) =>
    svg(`<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>`, size)
};
