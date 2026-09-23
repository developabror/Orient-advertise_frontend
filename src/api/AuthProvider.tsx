import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AuthContext, tokenToUser, type AuthUser, type Role } from './auth';
import { tokenStore } from './tokenStore';
import { onBroadcast } from './authChannel';
import { loginWithCredentials, logoutServer, refreshAccessToken } from './http';
import { getMe } from './resources/me';
import { wsClient } from './wsClient';
import { notify } from './notify';
import { BootstrapLoadingScreen } from '@components/BootstrapLoadingScreen';

interface Props {
  readonly children: ReactNode;
}

/**
 * Backoff between `/api/me` attempts. Two retries then give up: long enough to ride out a blip,
 * short enough that an operator is not staring at a spinner wondering whether it is stuck.
 */
const PROFILE_RETRY_DELAYS_MS = [1_000, 3_000] as const;

export const AuthProvider = ({ children }: Props) => {
  const [user, setUser] = useState<AuthUser | null>(() => tokenToUser(tokenStore.get()));
  const [bootstrapping, setBootstrapping] = useState(true);
  // `/api/me` failed every retry. Operator pages scope by the profile, so this is what lets them
  // show an error with a retry instead of an endless spinner (VG-12).
  const [profileFailed, setProfileFailed] = useState(false);
  // Bumped by reloadProfile to re-run the fetch effect on demand.
  const [profileAttempt, setProfileAttempt] = useState(0);

  // Detect server-side role changes: every refresh issues a fresh JWT, and if
  // the role flipped (e.g. admin demoted to advertiser), force re-auth instead
  // of silently re-skinning the UI. The API still owns authorization — this
  // is just to keep the client from showing a stale-permissions session.
  const previousRoleRef = useRef<Role | null>(null);

  useEffect(() => {
    previousRoleRef.current = tokenToUser(tokenStore.get())?.role ?? null;
    const unsub = tokenStore.subscribe((t) => {
      const decoded = tokenToUser(t);
      // Preserve the existing profile across token rotations for the
      // SAME user — refresh issues a new JWT but the user's profile
      // (id/createdAt/etc.) hasn't changed. Refetching /me on every
      // refresh would be wasteful; preserving here lets the dedicated
      // /me-fetch effect below skip the call when profile is already
      // populated. A different `sub` (rare, but possible across tab
      // races) gets a fresh fetch on the next pass.
      setUser((current) => {
        if (current?.sub === decoded?.sub && decoded !== null) {
          return { ...decoded, profile: current?.profile ?? null };
        }
        return decoded;
      });
      const newRole = decoded?.role ?? null;
      const oldRole = previousRoleRef.current;
      previousRoleRef.current = newRole;
      if (oldRole !== null && newRole !== null && oldRole !== newRole) {
        notify.warning('Your access level has changed. Please sign in again.');
        void logoutServer();
      }
    });
    return () => {
      unsub();
      previousRoleRef.current = null;
    };
  }, []);

  // Other tabs may refresh or log out — mirror their token state here without
  // making our own /api/auth/refresh call (which would race against rotation).
  useEffect(() => {
    return onBroadcast((msg) => {
      if (msg.type === 'token') tokenStore.set(msg.accessToken);
      else tokenStore.set(null);
    });
  }, []);

  // Silent refresh on first mount and on bfcache restore. The refresh token
  // lives in an HttpOnly cookie owned by the browser, so we ALWAYS attempt
  // /api/auth/refresh — even after a hard reload that cleared the in-memory
  // access token. If the cookie is present and valid, we get a fresh access
  // token back and the session is restored without a /login flash. If the
  // cookie is missing or expired the server returns 401, the catch clears
  // local state, and bootstrap resolves so the login screen renders. The
  // request is sent with _suppressErrorToast so a clean "not logged in"
  // boot shows no toast and no flash.
  useEffect(() => {
    let cancelled = false;
    const bootstrap = async (): Promise<void> => {
      try {
        await refreshAccessToken();
      } catch {
        tokenStore.set(null);
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    };
    void bootstrap();

    const onPageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) void bootstrap();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => {
      cancelled = true;
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  // Tie the WS lifecycle to WHO is signed in, not to the user object: it is
  // replaced on every token rotation and when /me loads, and none of those
  // should touch the socket. A different `sub` — another tab signed in as
  // someone else, which swaps the token without passing through logout —
  // must: the socket authenticated as the previous user at handshake and would
  // keep streaming their events here (FE-02). The cleanup disconnects on
  // logout, on a user switch (before the new user's connect) and on unmount.
  //
  // Only for the roles the backend serves the feed to (ADMIN/OPERATOR —
  // DashboardHandshakeInterceptor refuses the rest). Viewers and advertisers
  // used to retry, back off and pause forever behind a permanent "Live updates
  // paused" badge (VG-05); now they simply stay idle and their pages poll.
  const sub = user?.sub ?? null;
  const liveFeed = user?.role === 'admin' || user?.role === 'operator';
  useEffect(() => {
    if (sub === null || !liveFeed) return;
    wsClient.connect();
    return () => {
      wsClient.disconnect();
    };
  }, [sub, liveFeed]);

  // Fetch /api/me to populate `user.profile` for display fields. Runs
  // only when:
  //   - the user is authenticated, AND
  //   - profile hasn't been populated yet for THIS sub
  // The token-rotation handler above preserves an existing profile when
  // the same user's token rotates, so a refresh doesn't trigger a
  // /me refetch. A logout (user → null) clears everything; a different
  // sub appearing (cross-tab race, role-change forced relogin) gets its
  // own fetch.
  //
  // The JWT decode runs SYNCHRONOUSLY in tokenToUser, so display sites
  // can render `user.sub` / `user.role` immediately as the fast-path
  // while /me is in flight. Profile fields fade in once the response
  // lands. A failed /me leaves `profile: null` — not fatal; the JWT
  // fast-path values keep working.
  useEffect(() => {
    if (user?.profile != null || user === null) return;
    let cancelled = false;
    let timer: number | undefined;
    let attempt = 0;

    const fetchProfile = (): void => {
      void getMe()
        .then((profile) => {
          if (cancelled) return;
          setProfileFailed(false);
          setUser((current) => {
            if (current === null) return current;
            // Defensive: ignore the response if the user changed under us.
            if (current.sub !== profile.username) return current;
            return { ...current, profile };
          });
        })
        .catch(() => {
          if (cancelled) return;
          attempt += 1;
          if (attempt < PROFILE_RETRY_DELAYS_MS.length + 1) {
            // A transient blip (a proxy hiccup, a sleeping laptop waking) should cost a second,
            // not a working session.
            timer = window.setTimeout(fetchProfile, PROFILE_RETRY_DELAYS_MS[attempt - 1]);
            return;
          }
          // Out of retries. Say so, because an operator page cannot scope itself without the
          // profile and would otherwise sit on a spinner forever (VG-12). The JWT fast-path
          // values keep working for everything that does not need the profile.
          setProfileFailed(true);
        });
    };

    setProfileFailed(false);
    fetchProfile();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [user, profileAttempt]);

  /** Retry the profile fetch. Bumping the attempt counter re-runs the effect above. */
  const reloadProfile = useCallback((): void => {
    setProfileFailed(false);
    setProfileAttempt((n) => n + 1);
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<void> => {
    await loginWithCredentials(username, password);
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    await logoutServer();
  }, []);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: user !== null,
      bootstrapping,
      profileFailed,
      reloadProfile,
      login,
      logout,
    }),
    [user, bootstrapping, profileFailed, reloadProfile, login, logout],
  );

  // Hold all rendering on the bootstrap loading screen — never render Routes
  // (and therefore never flash /login) while /api/auth/refresh is in flight,
  // even if it takes several seconds. URL is preserved by BrowserRouter so
  // deep links (e.g. /devices) resolve to the right route once bootstrap
  // resolves.
  if (bootstrapping) {
    return <BootstrapLoadingScreen />;
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
