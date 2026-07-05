// Duration formatting for the playback report (and any future seconds → display
// need). The wire carries integer seconds only — there is no `totalDurationHms`
// field; the frontend formats locally.

// H:MM:SS from whole seconds; drop the hours segment when < 1h → M:SS.
// 86400 → "24:00:00", 90 → "1:30", 0 → "0:00". Hours are NOT capped at two
// digits (442506 → "122:55:06").
export const formatDuration = (totalSeconds: number): string => {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${String(h)}:${pad(m)}:${pad(sec)}` : `${String(m)}:${pad(sec)}`;
};

// Optional "total minutes" figure for the summary line. 86400 → 1440, 29 → 0,
// 30 → 1 (rounding).
export const totalMinutes = (totalSeconds: number): number =>
  Math.round(Math.max(0, totalSeconds) / 60);
