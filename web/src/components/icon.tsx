/**
 * Small line icons drawn inline (no icon library), 24x24 grid, stroke in the current text color.
 * Decorative only: the text next to them carries the meaning.
 */
const PATHS = {
  home: ["M3 11 12 4l9 7", "M5 10v10h14V10", "M10 20v-6h4v6"],
  pill: ["M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7Z", "M8.5 8.5l7 7"],
  residents: ["M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z", "M2.5 20a6.5 6.5 0 0 1 13 0", "M16 4.6a3.5 3.5 0 0 1 0 6.8", "M18 14.4a6.5 6.5 0 0 1 3.5 5.6"],
  pulse: ["M3 12h4l3-8 4 16 3-8h4"],
  notes: ["M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z", "M14 3v6h6", "M8 13h8", "M8 17h5"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7v5l3 2"],
  alert: ["M10.3 4.2 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z", "M12 9v4", "M12 17h.01"],
  shield: ["M12 3 4.5 6v6c0 4.6 3.2 7.9 7.5 9 4.3-1.1 7.5-4.4 7.5-9V6L12 3Z", "m9 12 2 2 4-4"],
  staff: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M4 21a8 8 0 0 1 16 0"],
  calendar: ["M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z", "M3 10h18", "M8 3v4", "M16 3v4"],
  list: ["M9 6h11", "M9 12h11", "M9 18h11", "M4.5 6h.01", "M4.5 12h.01", "M4.5 18h.01"],
  check: ["M20 6 9 17l-5-5"],
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  close: ["M6 6l12 12", "M18 6 6 18"],
  lock: ["M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z", "M8 11V7a4 4 0 0 1 8 0v4"],
  logout: ["M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3", "M10 17l-5-5 5-5", "M5 12h11"],
  settings: ["M4 6h9", "M17 6h3", "M15 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z", "M4 12h3", "M11 12h9", "M9 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z", "M4 18h11", "M19 18h1", "M17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
