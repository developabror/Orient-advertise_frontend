import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addDaysYmd,
  formatTashkent,
  tashkentDayEndUtc,
  tashkentDayStartUtc,
  tashkentLocalToUTC,
  tashkentPresetRange,
  tashkentToday,
  tashkentYmd,
  utcToTashkentLocal,
} from '../timezone';

// vite.config.ts pins this worker to TZ=Asia/Tashkent so datetime-local
// conversions are deterministic. That ALSO means a naive implementation built
// on getFullYear()/toISOString() would satisfy every assertion below purely by
// accident — which is how FE-08 survived in the first place. So each conversion
// is replayed under zones either side of Tashkent and under UTC. Node re-reads
// process.env.TZ on every Date operation, so flipping it mid-test is enough.
const ZONES = ['Asia/Tashkent', 'UTC', 'America/New_York', 'Pacific/Kiritimati'] as const;
const ORIGINAL_TZ = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
  vi.useRealTimers();
});

const inEveryZone = (assert: () => void): void => {
  for (const tz of ZONES) {
    process.env.TZ = tz;
    try {
      assert();
    } catch (err) {
      throw new Error(`failed under TZ=${tz}`, { cause: err });
    }
  }
};

describe('the zone-independence harness itself', () => {
  // If this ever goes red, every other test in this file has been passing
  // vacuously and the helpers are unverified.
  it('flipping process.env.TZ really does move the local clock', () => {
    const instant = '2026-09-18T20:30:00Z';
    process.env.TZ = 'UTC';
    expect(new Date(instant).getHours()).toBe(20);
    process.env.TZ = 'Asia/Tashkent';
    expect(new Date(instant).getHours()).toBe(1);
  });
});

describe('tashkentYmd', () => {
  it('rolls to the next calendar day at 19:00 UTC, in every host zone', () => {
    inEveryZone(() => {
      expect(tashkentYmd(new Date('2026-09-18T18:59:59.999Z'))).toBe('2026-09-18');
      expect(tashkentYmd(new Date('2026-09-18T19:00:00.000Z'))).toBe('2026-09-19');
      expect(tashkentYmd(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01');
      expect(tashkentYmd(new Date('2025-12-31T19:00:00Z'))).toBe('2026-01-01');
    });
  });

  it('returns "" for an invalid date rather than "NaN-NaN-NaN"', () => {
    expect(tashkentYmd(new Date('nope'))).toBe('');
  });
});

describe('tashkentDayStartUtc / tashkentDayEndUtc', () => {
  it('maps a Tashkent calendar day onto its exact UTC window', () => {
    inEveryZone(() => {
      expect(tashkentDayStartUtc('2026-09-18')).toBe('2026-09-17T19:00:00.000Z');
      expect(tashkentDayEndUtc('2026-09-18')).toBe('2026-09-18T18:59:59.999999Z');
    });
  });

  it('partitions the timeline: day N ends one microsecond below day N+1', () => {
    // The backend bounds with `>= from AND <= to`, INCLUSIVE at both ends.
    // These two literals are the whole point of the fix: nothing is counted in
    // two days, and nothing Postgres can store falls between them.
    expect(tashkentDayEndUtc('2026-09-18')).toBe('2026-09-18T18:59:59.999999Z');
    expect(tashkentDayStartUtc('2026-09-19')).toBe('2026-09-18T19:00:00.000Z');
  });

  it('crosses month and year boundaries', () => {
    inEveryZone(() => {
      expect(tashkentDayStartUtc('2026-01-01')).toBe('2025-12-31T19:00:00.000Z');
      expect(tashkentDayEndUtc('2026-12-31')).toBe('2026-12-31T18:59:59.999999Z');
      expect(tashkentDayEndUtc('2026-02-28')).toBe('2026-02-28T18:59:59.999999Z');
      expect(tashkentDayStartUtc('2024-02-29')).toBe('2024-02-28T19:00:00.000Z');
    });
  });

  it.each(['', '18/09/2026', '2026-9-8', '2026-13-01', '2026-02-30', 'garbage'])(
    'returns "" for junk input (%s)',
    (bad) => {
      expect(tashkentDayStartUtc(bad)).toBe('');
      expect(tashkentDayEndUtc(bad)).toBe('');
      expect(addDaysYmd(bad, 1)).toBe('');
    },
  );
});

describe('tashkentToday / tashkentPresetRange', () => {
  it('uses the Tashkent calendar day after 19:00 UTC — the case that fails today', () => {
    // 20:30Z on the 18th is 01:30 on the 19th in Tashkent. The old
    // toISOString().slice(0,10) and getUTCDate() implementations answered
    // "the 18th", which is why a report run at 1am showed yesterday.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-18T20:30:00Z'));
    inEveryZone(() => {
      expect(tashkentToday()).toBe('2026-09-19');
      expect(tashkentPresetRange(7)).toEqual({ dateFrom: '2026-09-12', dateTo: '2026-09-19' });
      expect(tashkentPresetRange(30)).toEqual({ dateFrom: '2026-08-20', dateTo: '2026-09-19' });
    });
  });

  it('agrees with UTC in the middle of the Tashkent day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-18T09:00:00Z'));
    inEveryZone(() => {
      expect(tashkentToday()).toBe('2026-09-18');
    });
  });

  it('wires straight through to the request bounds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-18T20:30:00Z'));
    const { dateFrom, dateTo } = tashkentPresetRange(7);
    expect(tashkentDayStartUtc(dateFrom)).toBe('2026-09-11T19:00:00.000Z');
    expect(tashkentDayEndUtc(dateTo)).toBe('2026-09-19T18:59:59.999999Z');
  });
});

describe('addDaysYmd', () => {
  it('is pure calendar arithmetic, zone-free', () => {
    inEveryZone(() => {
      expect(addDaysYmd('2026-03-01', -1)).toBe('2026-02-28');
      expect(addDaysYmd('2024-03-01', -1)).toBe('2024-02-29'); // leap year
      expect(addDaysYmd('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDaysYmd('2026-09-18', 0)).toBe('2026-09-18');
    });
  });

  it('returns "" rather than garbage for inputs it cannot honour', () => {
    // These all used to produce strings like '0NaN-NaN-NaN' or '10000-01-01',
    // which then failed silently somewhere downstream instead of here.
    expect(addDaysYmd('2026-09-18', Number.NaN)).toBe('');
    expect(addDaysYmd('2026-09-18', 0.5)).toBe('');
    expect(addDaysYmd('9999-12-31', 1)).toBe(''); // would be year 10000
    expect(addDaysYmd('0001-01-01', -1)).toBe(''); // would be year 0
  });
});

describe('the "invalid input → empty string" contract holds at the edges', () => {
  it('does not leak NaN into a formatted date', () => {
    // Shifting an instant near the edge of the Date range overflows, and
    // String(NaN).padStart(4,'0') is '0NaN' — so the guard is load-bearing.
    expect(tashkentYmd(new Date(8.64e15))).toBe('');
    expect(tashkentYmd(new Date(-8.64e15))).toBe('');
  });
});

// The module had no coverage at all before this; pin the pre-existing helpers
// too, since the report fix now depends on them.
describe('pre-existing helpers are already zone-independent', () => {
  it('formatTashkent / utcToTashkentLocal / tashkentLocalToUTC', () => {
    inEveryZone(() => {
      expect(formatTashkent('2026-06-03T18:00:00Z')).toBe('03 Jun 2026, 23:00');
      expect(formatTashkent(null)).toBe('—');
      expect(formatTashkent('not-a-date')).toBe('—');
      expect(utcToTashkentLocal('2026-06-03T18:00:00Z')).toBe('2026-06-03T23:00');
      expect(tashkentLocalToUTC('2026-06-03T23:00')).toBe('2026-06-03T18:00:00.000Z');
      expect(tashkentLocalToUTC('')).toBe('');
    });
  });
});
