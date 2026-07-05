import { describe, expect, it } from 'vitest';
import { formatDuration, totalMinutes } from '../formatDuration';

describe('formatDuration', () => {
  it('formats M:SS under an hour and H:MM:SS at/over an hour', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(90)).toBe('1:30');
    expect(formatDuration(3599)).toBe('59:59');
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(86400)).toBe('24:00:00');
  });

  it('does not cap hours at two digits', () => {
    expect(formatDuration(442506)).toBe('122:55:06');
  });

  it('floors fractional seconds and clamps negatives to 0', () => {
    expect(formatDuration(90.9)).toBe('1:30');
    expect(formatDuration(-5)).toBe('0:00');
  });
});

describe('totalMinutes', () => {
  it('rounds seconds to whole minutes', () => {
    expect(totalMinutes(86400)).toBe(1440);
    expect(totalMinutes(29)).toBe(0);
    expect(totalMinutes(30)).toBe(1);
  });
});
