// Shared timezone helpers.
//
// The backend stores and returns **UTC** instants; the product's canonical
// display zone is **Tashkent (UTC+5, no DST)**. These helpers convert between
// the two for display and for the local-naive "YYYY-MM-DDTHH:mm" format that
// `<input type="datetime-local">` uses.
//
// Extracted from ContentSchedulesDrawer so the Assign-content drawer and every
// other assignment/schedule surface format identically instead of each
// re-implementing the conversion (and drifting).

export const TASHKENT_TZ = 'Asia/Tashkent';
export const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

const TASHKENT_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: TASHKENT_TZ,
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Format a UTC ISO instant for display in Tashkent local time
 * (e.g. `03 Jun 2026, 23:00`). `null`/invalid input → `'—'`.
 */
export const formatTashkent = (iso: string | null): string => {
  if (iso === null) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return TASHKENT_FORMATTER.format(d);
};

/**
 * UTC ISO instant → Tashkent-local `"YYYY-MM-DDTHH:mm"` (the value an
 * `<input type="datetime-local">` expects). Invalid input → `''`.
 */
export const utcToTashkentLocal = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const t = new Date(d.getTime() + TASHKENT_OFFSET_MS);
  const yyyy = String(t.getUTCFullYear());
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(t.getUTCDate()).padStart(2, '0');
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mn = String(t.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mn}`;
};

/**
 * Tashkent-local `"YYYY-MM-DDTHH:mm"` → UTC ISO instant. `''` → `''`.
 *
 * Treats the local datetime string as if it were UTC, then subtracts the
 * Tashkent offset to land on the actual UTC instant.
 */
export const tashkentLocalToUTC = (local: string): string => {
  if (local === '') return '';
  const asIfUTC = new Date(`${local}:00Z`).getTime();
  if (Number.isNaN(asIfUTC)) return '';
  return new Date(asIfUTC - TASHKENT_OFFSET_MS).toISOString();
};
