// Vitest unit tests for the canonicalizeWsUrl validator in env.ts.
//
// We test the helper in isolation (not the `env` constant itself,
// which throws at module-init time on a missing/malformed value) so
// each case is independent.

import { describe, expect, it } from 'vitest';

import { canonicalizeWsUrl } from '../env';

describe('canonicalizeWsUrl', () => {
  it('returns the URL unchanged when it already ends with /ws', () => {
    expect(canonicalizeWsUrl('ws://localhost:8080/ws')).toBe('ws://localhost:8080/ws');
    expect(canonicalizeWsUrl('wss://api.example.com/ws')).toBe('wss://api.example.com/ws');
  });

  it('strips a trailing slash silently', () => {
    expect(canonicalizeWsUrl('ws://localhost:8080/ws/')).toBe('ws://localhost:8080/ws');
    expect(canonicalizeWsUrl('wss://api.example.com/ws/')).toBe('wss://api.example.com/ws');
  });

  it('throws a clear error when the /ws suffix is missing', () => {
    expect(() => canonicalizeWsUrl('ws://localhost:8080')).toThrow(
      'VITE_WS_URL must end with /ws — got ws://localhost:8080',
    );
  });

  it('includes the offending raw value (not the trimmed one) in the error message', () => {
    expect(() => canonicalizeWsUrl('ws://localhost:8080/')).toThrow(
      'VITE_WS_URL must end with /ws — got ws://localhost:8080/',
    );
  });

  it('rejects a path that ends with a similar-looking but wrong suffix', () => {
    expect(() => canonicalizeWsUrl('ws://localhost:8080/api')).toThrow(
      'VITE_WS_URL must end with /ws',
    );
    expect(() => canonicalizeWsUrl('ws://localhost:8080/wsx')).toThrow(
      'VITE_WS_URL must end with /ws',
    );
  });

  it('accepts wss:// (production scheme)', () => {
    expect(canonicalizeWsUrl('wss://prod.example.com/ws')).toBe('wss://prod.example.com/ws');
  });
});
