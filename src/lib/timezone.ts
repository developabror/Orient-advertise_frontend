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

// ---------------------------------------------------------------------------
// Report windows.
//
// Reports are requested as a Tashkent calendar day range but sent to the
// backend as UTC instants, and the backend bounds them INCLUSIVELY
// (`playedAt >= :from AND playedAt <= :to`, PlaybackLogRepository /
// EventRepository). Everything below exists so a "day" means the same thing on
// both sides of the wire, on any host clock.
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `Date` → `YYYY-MM-DD` read in UTC, or `''` if the date is not representable.
 *
 * The guard is not decorative: shifting an instant near the edge of the Date
 * range overflows to `NaN`, and `String(NaN).padStart(4, '0')` is `'0NaN'` — so
 * without it these helpers would return `'0NaN-NaN-NaN'` while their contracts
 * promise `''`. Years outside 0001-9999 are rejected too, because they
 * serialize as extended (`+275760-…`) forms that no caller can consume.
 */
const ymdFromUtcParts = (t: Date): string => {
  const year = t.getUTCFullYear();
  if (!Number.isFinite(year) || year < 1 || year > 9999) return '';
  const yyyy = String(year).padStart(4, '0');
  const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(t.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/** Parses a strict `YYYY-MM-DD` as UTC midnight. Junk (incl. `2026-02-30`) → `NaN`. */
const parseYmd = (ymd: string): number => {
  if (!YMD_RE.test(ymd)) return Number.NaN;
  const ms = Date.parse(`${ymd}T00:00:00Z`);
  // Date.parse rolls 2026-02-30 over to 2026-03-02 rather than rejecting it, so
  // round-trip it and require the calendar day to survive.
  if (Number.isNaN(ms) || ymdFromUtcParts(new Date(ms)) !== ymd) return Number.NaN;
  return ms;
};

/**
 * Tashkent calendar date (`YYYY-MM-DD`) for a UTC instant. Invalid input → `''`.
 *
 * Shift-then-read-UTC, the same trick `utcToTashkentLocal` uses: it never reads
 * the host's local clock, so the answer is identical on an operator's Tashkent
 * laptop, a UTC CI runner, and a browser in New York.
 */
export const tashkentYmd = (instant: Date = new Date()): string => {
  const ms = instant.getTime();
  if (Number.isNaN(ms)) return '';
  return ymdFromUtcParts(new Date(ms + TASHKENT_OFFSET_MS));
};

/** Today's date on the Tashkent calendar — NOT the host's "today". */
export const tashkentToday = (): string => tashkentYmd(new Date());

/**
 * Calendar arithmetic on a naive `YYYY-MM-DD`. No zone is involved.
 * A non-integer `days`, or a result outside the representable range, → `''`.
 */
export const addDaysYmd = (ymd: string, days: number): string => {
  const ms = parseYmd(ymd);
  if (Number.isNaN(ms) || !Number.isInteger(days)) return '';
  return ymdFromUtcParts(new Date(ms + days * MS_PER_DAY));
};

/**
 * Tashkent `YYYY-MM-DD` → the UTC instant of that day's 00:00 in Tashkent, for
 * the backend's `>= :from` bound. `'2026-09-18'` → `'2026-09-17T19:00:00.000Z'`.
 * Invalid input → `''`.
 */
export const tashkentDayStartUtc = (ymd: string): string => {
  const ms = parseYmd(ymd);
  if (Number.isNaN(ms)) return '';
  return new Date(ms - TASHKENT_OFFSET_MS).toISOString();
};

/**
 * Tashkent `YYYY-MM-DD` → the last instant of that day, for the backend's
 * INCLUSIVE `<= :to` bound. `'2026-09-18'` → `'2026-09-18T18:59:59.999999Z'`.
 *
 * Why microseconds, and not simply the next midnight:
 *  - Handing it the next Tashkent midnight would count a row landing exactly on
 *    the boundary in BOTH days, because the bound is `<=`. These are
 *    billing-relevant play counts and device timestamps are routinely
 *    second-truncated, so a playlist loop starting at 00:00:00 Tashkent is a
 *    normal event, not a freak one.
 *  - Postgres stores timestamps at microsecond resolution, so `…59.999999Z` is
 *    the largest value the column can hold below the next midnight. An
 *    inclusive bound there is EXACTLY the half-open window
 *    [day start, next day start): nothing double-counted, nothing dropped. A
 *    `.999` millisecond floor would instead lose the last 999µs of every day.
 *  - JS `Date` carries only milliseconds, and the day/offset constants are
 *    whole milliseconds, so `endMs` always lands on `.999`; the last three
 *    digits are appended textually. `Instant` and `ISO_INSTANT` /
 *    `ISO_DATE_TIME` / `ISO_OFFSET_DATE_TIME` all parse 0-9 fractional digits,
 *    so the backend accepts it (verified against Java 21).
 */
export const tashkentDayEndUtc = (ymd: string): string => {
  const ms = parseYmd(ymd);
  if (Number.isNaN(ms)) return '';
  const endMs = ms + MS_PER_DAY - TASHKENT_OFFSET_MS - 1; // → '…T18:59:59.999Z'
  return `${new Date(endMs).toISOString().slice(0, -1)}999Z`;
};

/**
 * The shared "last N days" preset, on the Tashkent calendar.
 *
 * NOTE the inherited off-by-one: `dateFrom = today - days` with both ends
 * INCLUSIVE makes `tashkentPresetRange(7)` an EIGHT-day window. All four of the
 * copied implementations this replaces behaved that way. Correcting it here
 * would move every report's totals in the same commit as a timezone fix, and
 * then nobody could attribute a discrepancy to either one. Change it
 * separately, deliberately, if at all.
 */
export const tashkentPresetRange = (
  days: number,
): { readonly dateFrom: string; readonly dateTo: string } => {
  const dateTo = tashkentToday();
  return { dateFrom: addDaysYmd(dateTo, -days), dateTo };
};
