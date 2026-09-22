import { describe, expect, it } from 'vitest';

import { safeRedirect } from '../safeRedirect';

// FE-13 / GHSA-wrjc-x8rr-h8h6. `?redirect=` is the only navigation path an
// attacker controls; react-router 6 does not fully guard it (fixed only in v7),
// so this check must keep every value an in-app path.
describe('safeRedirect', () => {
  it('keeps an in-app path with its query and hash', () => {
    expect(safeRedirect('/devices/12?tab=logs#top')).toBe('/devices/12?tab=logs#top');
  });

  it('falls back to the dashboard when there is nothing to go back to', () => {
    expect(safeRedirect(null)).toBe('/dashboard');
    expect(safeRedirect('')).toBe('/dashboard');
  });

  it.each([
    ['an absolute URL', 'https://evil.example/phish'],
    ['a protocol-relative URL', '//evil.example'],
    ['a backslash (browsers read /\\ as //)', '/\\evil.example'],
    ['a backslash later in the path', '/devices\\..\\evil.example'],
    ['a tab or newline smuggled into the path', '/\t/evil.example'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a relative path', 'devices'],
  ])('refuses %s', (_label, raw) => {
    expect(safeRedirect(raw)).toBe('/dashboard');
  });

  it('refuses the URL-encoded backslash from the review once the router decodes it', () => {
    const decoded = new URLSearchParams('redirect=/%5Cevil.example').get('redirect');
    expect(safeRedirect(decoded)).toBe('/dashboard');
  });
});
