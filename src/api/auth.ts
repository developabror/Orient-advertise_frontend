import { createContext } from 'react';
import type { MeResponse } from './resources/me';

// Backend roles per OpenAPI: ADMIN, OPERATOR, VIEWER, ADVERTISER. The FE keeps
// its existing lowercase shape (used by routing/sidebar). VIEWER maps to
// 'viewer' — read-only screens. The mapping happens in tokenToUser.
export type Role = 'admin' | 'operator' | 'viewer' | 'advertiser';

/**
 * The authenticated user record exposed via AuthContext.
 *
 * `sub` and `role` come from the JWT — they are the **authorization
 * signal** and route guards / role checks must read from these fields.
 *
 * `profile` is fetched from /api/me after login/refresh and carries
 * **display-only fields** (canonical username spelling, id, createdAt).
 * It's null between login and the first /me round-trip — display sites
 * should fall back to `sub` / `role` while profile is still loading
 * (this is the documented JWT fast-path). NEVER use profile fields to
 * gate authorization.
 */
export interface AuthUser {
  readonly sub: string;
  readonly role: Role;
  readonly profile: MeResponse | null;
}

export interface AuthContextValue {
  readonly user: AuthUser | null;
  readonly isAuthenticated: boolean;
  readonly bootstrapping: boolean;
  readonly login: (username: string, password: string) => Promise<void>;
  readonly logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

const decodeBase64Url = (segment: string): string => {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
};

const normaliseRole = (value: unknown): Role | null => {
  if (typeof value !== 'string') return null;
  const v = value.toLowerCase();
  if (v === 'admin' || v === 'operator' || v === 'viewer' || v === 'advertiser') return v;
  return null;
};

interface RawJwtPayload {
  readonly sub?: unknown;
  readonly exp?: unknown;
  readonly role?: unknown;
  readonly roles?: unknown;
  readonly authorities?: unknown;
}

// Spring sometimes encodes roles in `roles` or `authorities` arrays (with a
// `ROLE_` prefix). This handles all three shapes — sub + exp + first known
// role, however it's encoded.
const extractRole = (p: RawJwtPayload): Role | null => {
  const direct = normaliseRole(p.role);
  if (direct) return direct;
  for (const arr of [p.roles, p.authorities]) {
    if (Array.isArray(arr)) {
      for (const r of arr) {
        if (typeof r !== 'string') continue;
        const role = normaliseRole(r.replace(/^ROLE_/i, ''));
        if (role) return role;
      }
    }
  }
  return null;
};

export const tokenToUser = (token: string | null): AuthUser | null => {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadSegment = parts[1];
    if (!payloadSegment) return null;
    const parsed = JSON.parse(decodeBase64Url(payloadSegment)) as RawJwtPayload;
    if (typeof parsed.sub !== 'string') return null;
    if (typeof parsed.exp !== 'number') return null;
    if (parsed.exp * 1000 <= Date.now()) return null;
    const role = extractRole(parsed);
    if (role === null) return null;
    // profile is populated separately by AuthProvider via /api/me — see
    // the AuthUser docstring. The JWT decode here is the fast-path for
    // route guards; profile is for richer display.
    return { sub: parsed.sub, role, profile: null };
  } catch {
    return null;
  }
};
