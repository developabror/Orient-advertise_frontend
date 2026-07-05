# ADR 0001 — Refresh-token storage strategy

**Status:** Accepted (interim — see "Open backend dependency" below)
**Date:** 2026-05-08
**Deciders:** Frontend (this repo) + Backend (open ticket required for full resolution)

## Context

The Orient Advertise SPA authenticates against the backend via
`POST /auth/login`, which returns `{ accessToken, refreshToken }` in the
JSON body. The access token is short-lived; the refresh token is
single-use and rotates on every `/auth/refresh` call.

`src/api/tokenStore.ts` currently holds **both tokens in memory only.**
There is no `localStorage`, no `sessionStorage`, and no `HttpOnly`
cookie. Consequence: a full page reload (or a closed-and-reopened tab)
logs the user out, because the refresh token used to silently restore
the session is gone.

Three storage strategies were considered:

1. **Memory only** (status quo). XSS-resistant — a successful XSS
   payload cannot exfiltrate tokens because there is no persistent
   surface to read from. Cost: every full reload logs the user out.
2. **`localStorage` / `sessionStorage`.** Survives reloads. Exposed to
   any XSS within the same origin: a `<script>` injection or a
   compromised dependency can `localStorage.getItem('refresh-token')`
   and exfiltrate it.
3. **`HttpOnly`, `Secure`, `SameSite=Strict` cookie.** Survives reloads.
   JavaScript cannot read the cookie, so XSS cannot exfiltrate it.
   Requires backend change: `/auth/login` must set the cookie via
   `Set-Cookie`, and `/auth/refresh` must read the cookie instead of
   the request body.

## Decision

**Keep memory-only storage (option 1) as the interim posture.**
The XSS-minimization argument outweighs the reload-UX cost given the
operator-facing nature of this app:

- **Threat model.** The app is used by ADMIN/OPERATOR/VIEWER/ADVERTISER
  roles in administrative dashboards. ADMIN can mint API keys, delete
  users, revoke API keys, and reboot devices — token theft on an ADMIN
  session is the highest-impact compromise scenario in the system.
- **Reload frequency.** Operators typically open the dashboard at the
  start of a shift and leave it open. Reload-logout is annoying but
  rare.
- **No other persistent secret on the client.** Keeping it that way
  means an XSS report becomes a "session hijack while the user is
  logged in" rather than "permanent credential exposure."

Option 3 (HttpOnly cookie) is the **target end state**, but it requires
a backend change to `/auth/login` and `/auth/refresh`. That work is
out of scope for this ticket — see "Open backend dependency."

## Consequences

### Code-side

- `src/api/tokenStore.ts` keeps tokens in two module-level `let`s. A
  comment block at the top of that file pins this decision to the
  rationale above.
- `src/api/AuthProvider.tsx`'s `bootstrap()` effect (silent refresh on
  first mount and on bfcache restore) early-returns when
  `tokenStore.getRefresh()` is null — no `/auth/refresh` call, no error
  toast, just resolve `bootstrapping` to `false` so the app renders the
  login screen. **Verified: this path is already correct as of FE-XX.**
- `loginWithCredentials` writes both tokens to `tokenStore`; the user
  flows through the normal app from there.

### UX

- A full page reload logs the user out. The login form picks up the
  intended deep link via `BrowserRouter`'s preserved URL — after
  logging in, the user lands back on the page they were trying to
  reach. The cost is one extra credential entry per reload, not lost
  navigation.
- BFCache (`pageshow` with `event.persisted === true`) attempts the
  silent refresh; if the refresh token has rotated past validity in
  another tab, this also lands on the login screen.
- Cross-tab token rotation works via `BroadcastChannel` (see
  `src/api/authChannel.ts`) — tabs share the in-memory token within a
  single browser session.

### Security

- XSS payloads cannot exfiltrate the refresh token. They CAN steal an
  active access token from `tokenStore` while a session is live, but
  the access token expires in minutes and cannot be used to mint new
  tokens (only the refresh token can, and it's single-use).
- Persistent compromise (i.e. surviving a reload) is not possible
  through token theft alone.

## Open backend dependency

**This ADR cannot be fully closed by frontend work.** Migrating to
option 3 (HttpOnly cookie) requires the backend to:

1. On `POST /auth/login` success, set a `Set-Cookie` header for the
   refresh token: `HttpOnly; Secure; SameSite=Strict; Path=/auth`.
2. On `POST /auth/refresh`, read the refresh token from the cookie
   instead of the JSON body.
3. On `POST /auth/logout`, clear the cookie via `Set-Cookie:
   refresh-token=; Max-Age=0`.

When that work lands, this ADR will be superseded by ADR 0002. Until
then, the memory-only posture stays in place and is documented at the
relevant code sites.

## Alternatives rejected

- **`localStorage`** — too exposed for an ADMIN-capable interface.
- **`sessionStorage`** — marginal improvement over `localStorage`
  (cleared on tab close, but still XSS-readable within the session).
  Not worth the persistence the user gains.
- **In-memory + service worker mirror** — clever but fragile across
  bfcache and Safari ITP edge cases. Not worth the complexity.
