---
name: security
description: Use this skill whenever writing or reviewing code that handles input, authentication, authorization, sessions, JWTs, cookies, CORS, CSRF, persistence, file paths, command execution, deserialization, secrets, or anything user-facing. Enforces application-security defaults — input validation, parameterized queries, XSS/SSRF/injection prevention, JWT rotation and HttpOnly cookie storage, CORS allow-lists, rate limiting on auth endpoints, dependency audit, secrets hygiene, and Spring Boot specifics (@PreAuthorize, SecurityFilterChain, CSRF, GlobalExceptionHandler).
---

# Security Skill

Security is **default-on, not an afterthought**. Every endpoint is authenticated unless explicitly marked public. Every input is untrusted.

---

## Input Validation & Sanitization

1. **Validate at the boundary** — reject invalid input before it reaches business logic.
2. **Allow-list, not deny-list.** Define what's valid; reject everything else.
3. **Enforce types, lengths, ranges, formats** (regex for structured fields, max sizes for strings, bounded numerics).
4. **Sanitize on output**, not input — encode for the destination context (HTML, SQL, shell, URL, JSON).

### Spring Boot
```java
public record CreateUserRequest(
    @NotBlank @Email @Size(max = 254) String email,
    @NotBlank @Size(min = 12, max = 128) String password,
    @NotBlank @Pattern(regexp = "^[a-zA-Z0-9_-]{3,32}$") String username
) {}

@PostMapping("/users")
public ResponseEntity<UserResponse> create(@Valid @RequestBody CreateUserRequest req) { … }
```

Always pair `@Valid` with a `GlobalExceptionHandler` that maps `MethodArgumentNotValidException` to a 400 with the standard error envelope (see `api-design`).

---

## SQL Injection — Prevention

**Always parameterized queries.** No string concatenation, no template interpolation, ever.

```java
// ✅ good — JdbcTemplate
jdbc.query("SELECT * FROM users WHERE email = ?", new Object[]{ email }, rowMapper);

// ✅ good — JPA / Spring Data
@Query("select u from User u where u.email = :email")
Optional<User> findByEmail(@Param("email") String email);

// ❌ bad — never do this
jdbc.queryForList("SELECT * FROM users WHERE email = '" + email + "'");
```

For dynamic ORDER BY / table names that can't be parameterized: validate against a **server-side allow-list** of known column/table names.

---

## XSS Prevention

1. **Auto-escape templates** — Thymeleaf, React JSX, Angular interpolation, Vue mustache all escape by default. Don't disable.
2. **Never** inject untrusted data into `innerHTML`, `dangerouslySetInnerHTML`, `v-html`, or `[innerHTML]` without sanitizing first (DOMPurify or equivalent).
3. **Set headers**:
   - `Content-Security-Policy: default-src 'self'; object-src 'none'; base-uri 'self'`
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy: strict-origin-when-cross-origin`
4. Cookies handling sessions: `HttpOnly; Secure; SameSite=Lax` (or `Strict` if no cross-site nav).

---

## CORS Configuration

Hard rules:
1. **Never** `Access-Control-Allow-Origin: *` for endpoints that accept credentials.
2. Use an **explicit allow-list of origins**, sourced from config — not regex over user input.
3. **Never** reflect the `Origin` header back without validating against the list.

### Spring Boot
```java
@Bean
CorsConfigurationSource corsConfigurationSource(@Value("${cors.allowed-origins}") List<String> origins) {
    CorsConfiguration cfg = new CorsConfiguration();
    cfg.setAllowedOrigins(origins);                    // explicit list
    cfg.setAllowedMethods(List.of("GET","POST","PUT","PATCH","DELETE"));
    cfg.setAllowedHeaders(List.of("Authorization","Content-Type"));
    cfg.setAllowCredentials(true);
    cfg.setMaxAge(3600L);
    UrlBasedCorsConfigurationSource src = new UrlBasedCorsConfigurationSource();
    src.registerCorsConfiguration("/api/**", cfg);
    return src;
}
```

---

## JWT Handling

Defaults:
- **Access token** lifetime: **15 minutes** max.
- **Refresh token** lifetime: **7–30 days**, **rotate on every use** (one-time use), bound to a session id, server-side revocable.
- **Algorithm**: `RS256` (asymmetric) or `EdDSA`. **Never** `none`. Reject tokens whose `alg` doesn't match server expectation.
- **Storage**: refresh token in `HttpOnly; Secure; SameSite=Strict` cookie. Access token in memory only — **not** localStorage.
- **Validate**: `iss`, `aud`, `exp`, `nbf`, `sub` on every request.
- **Revocation**: maintain a revocation list (jti) for forced logout; check on refresh.

### Spring Boot
```java
@Bean
SecurityFilterChain api(HttpSecurity http, JwtDecoder decoder) throws Exception {
    return http
        .csrf(csrf -> csrf.disable())                          // stateless API only
        .sessionManagement(s -> s.sessionCreationPolicy(STATELESS))
        .authorizeHttpRequests(a -> a
            .requestMatchers("/api/v1/auth/**", "/healthz", "/readyz").permitAll()
            .anyRequest().authenticated())
        .oauth2ResourceServer(o -> o.jwt(j -> j.decoder(decoder)))
        .headers(h -> h
            .contentSecurityPolicy(c -> c.policyDirectives("default-src 'self'"))
            .frameOptions(f -> f.deny()))
        .build();
}
```

CSRF: **disable only** for stateless token-auth APIs. For session/cookie auth keep it on (`CookieCsrfTokenRepository.withHttpOnlyFalse()`).

---

## Authorization

Enforce at the controller AND service layer. Defense-in-depth.

```java
@PreAuthorize("hasRole('ADMIN') or #userId == authentication.principal.id")
public UserDto getUser(UUID userId) { … }
```

Rules:
- Roles for coarse access (`ADMIN`, `USER`).
- Permissions/scopes for fine-grained (`orders:read`, `orders:write`).
- Always check **resource ownership** — IDs in the path are not authorization. Querying for `WHERE id = ? AND owner_id = currentUser` is mandatory.

---

## Rate Limiting

Apply at the edge (gateway / reverse proxy) AND at the app layer for sensitive routes.

Defaults:
| Route class | Limit |
|---|---|
| Login / signup / password reset | 5 / minute / IP, 10 / hour / account |
| Generic authenticated API | 100 / minute / user |
| Public read API | 60 / minute / IP |
| Search | 30 / minute / user |

Implementation: token bucket via Redis (Bucket4j on Spring, `express-rate-limit` on Node, NGINX `limit_req` at edge). Return `429` with `Retry-After`.

---

## Secrets — Never in Code or Logs

1. No secrets in source — enforce with `gitleaks` pre-commit + CI.
2. No secrets in container images / Dockerfiles — use BuildKit `--mount=type=secret`.
3. No secrets in logs — redact at logger level. Mask query strings containing `token`, `password`, `secret`, `key`.
4. Errors returned to clients **never** include stack traces, SQL, or internal paths.

---

## Dependency Hygiene

- Lockfiles committed (`package-lock.json`, `gradle.lockfile`, `poetry.lock`, `Pipfile.lock`).
- Run SCA in CI: `npm audit --omit=dev`, `pip-audit`, `gradle dependencyCheckAnalyze`, `trivy fs .`.
- **Fail the build** on `high` / `critical`. Allow `medium` with a tracked ticket.
- Renovate/Dependabot enabled with grouped PRs, auto-merge on patch updates with green CI.
- Pin **direct** dependencies; let lockfile resolve transitives.

---

## Spring Boot — Security Defaults Cheat Sheet

```java
// Method-level
@EnableMethodSecurity                          // turn on @PreAuthorize
@PreAuthorize("hasAuthority('SCOPE_orders:write')")

// Filter chain — minimum hardening
.headers(h -> h
    .httpStrictTransportSecurity(hsts -> hsts.includeSubDomains(true).maxAgeInSeconds(31536000))
    .contentTypeOptions(Customizer.withDefaults())
    .referrerPolicy(r -> r.policy(STRICT_ORIGIN_WHEN_CROSS_ORIGIN))
    .frameOptions(f -> f.deny()))

// Error handling — never leak internals
@RestControllerAdvice
class GlobalExceptionHandler {
    @ExceptionHandler(Exception.class)
    ResponseEntity<ErrorEnvelope> any(Exception e) {
        log.error("unhandled", e);             // full detail server-side
        return ResponseEntity.status(500).body(
            new ErrorEnvelope("INTERNAL", "Internal error", List.of()));
    }
}
```

---

## Review Checklist

Run through this on every change that touches input, auth, or persistence:

- [ ] All inputs validated with allow-list rules
- [ ] All DB access uses parameterized queries / ORM, no string concat
- [ ] Output encoding matches context (HTML/JSON/URL)
- [ ] CORS uses explicit origin allow-list, no `*` with credentials
- [ ] Endpoints have `@PreAuthorize` or equivalent; default-deny
- [ ] Resource ownership verified, not assumed from path
- [ ] JWT validated for `iss/aud/exp/alg`; refresh rotates
- [ ] Cookies are `HttpOnly; Secure; SameSite`
- [ ] Rate limits on auth + sensitive endpoints
- [ ] No secrets in code, images, or logs
- [ ] Errors return generic messages to clients; details only in server logs
- [ ] Security headers set (CSP, HSTS, X-Content-Type-Options, Referrer-Policy)
- [ ] Dependencies free of known critical/high CVEs
