---
name: api-design
description: Use this skill whenever designing or implementing REST endpoints, controllers, request/response DTOs, route paths, status codes, pagination, error envelopes, API versioning, idempotency keys, or OpenAPI/Swagger annotations. Enforces plural-noun resource naming under /api/v1/, the standard error envelope { error: { code, message, details, traceId } }, capped pagination, DTO separation from entities, and Spring Boot specifics (@RestController, @Valid, ResponseEntity, GlobalExceptionHandler).
---

# REST API Design Skill

A REST API is a contract. Make it predictable, versioned, and documented.

---

## Resource Naming

- **Plural nouns** for collections: `/users`, `/orders`, `/invoices`.
- **No verbs** in paths. The HTTP method is the verb.
- Hierarchical, but **flat preferred** when possible: `/orders/{id}/items` ok; `/users/{id}/orders/{oid}/items/{iid}/notes` not ok — too brittle.
- `kebab-case` for multi-word segments: `/payment-methods`, not `/paymentMethods` or `/payment_methods`.
- IDs are **opaque** to the client. UUIDs preferred over auto-increment integers (no enumeration leaks).

| Action | Method | Path |
|---|---|---|
| List | `GET` | `/orders` |
| Read | `GET` | `/orders/{id}` |
| Create | `POST` | `/orders` |
| Replace | `PUT` | `/orders/{id}` |
| Partial update | `PATCH` | `/orders/{id}` |
| Delete | `DELETE` | `/orders/{id}` |
| Action (rare) | `POST` | `/orders/{id}/cancel` |

---

## HTTP Status Codes

Use these and only these by default:

| Code | When |
|---|---|
| `200 OK` | Successful GET / PATCH / non-creating POST |
| `201 Created` | Resource created. Include `Location` header. |
| `202 Accepted` | Async work queued |
| `204 No Content` | Successful DELETE / PUT with no response body |
| `400 Bad Request` | Validation failure, malformed body |
| `401 Unauthorized` | Missing or invalid credentials |
| `403 Forbidden` | Authenticated but not allowed |
| `404 Not Found` | Resource does not exist (or caller may not see it) |
| `409 Conflict` | State conflict — duplicate key, version mismatch |
| `422 Unprocessable Entity` | Semantically invalid (use 400 if unsure) |
| `429 Too Many Requests` | Rate limit exceeded. Include `Retry-After`. |
| `500 Internal Server Error` | Unhandled server error. Generic message only. |
| `503 Service Unavailable` | Dependency down / draining. Include `Retry-After`. |

---

## Pagination

Two options. Pick **one** per resource and stick with it.

### Offset/limit (simple, fine for small/medium collections)
```
GET /orders?page=2&size=50&sort=createdAt,desc
```
Response includes:
```json
{
  "data": [ … ],
  "page": { "number": 2, "size": 50, "totalElements": 1247, "totalPages": 25 }
}
```

### Cursor-based (preferred for high-volume / streaming feeds)
```
GET /events?cursor=eyJpZCI6Li4ufQ&limit=100
```
Response:
```json
{
  "data": [ … ],
  "page": { "nextCursor": "eyJpZCI6Li4ufQ", "limit": 100 }
}
```

Defaults: `size=20`, max `size=100`. Reject `size > 100` with 400.

---

## Error Response Envelope

**One** shape, used by every error response, every service.

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "One or more fields are invalid.",
    "details": [
      { "field": "email", "issue": "must be a valid email address" },
      { "field": "password", "issue": "must be at least 12 characters" }
    ],
    "traceId": "a1b2c3d4e5f6"
  }
}
```

Rules:
- `code` is a **stable, machine-readable** UPPER_SNAKE string. Clients branch on `code`, not `message`.
- `message` is human-readable, stable enough to log, never includes stack traces or internal paths.
- `details` is an array (possibly empty). Per-field violations go here.
- `traceId` echoes the W3C trace id so support can correlate with logs.

---

## Versioning

- URL versioning: `/api/v1/...`. Prefer over header-based — easier to debug.
- Bump the major when you make a **breaking change**. Otherwise additive.
- Run **two versions in parallel** during a deprecation window (≥ 6 months). Document the sunset date.
- `Sunset:` and `Deprecation:` headers on the old version.

---

## Request / Response DTO Separation

- **Never** expose JPA entities directly in controllers.
- `…Request` DTO for inbound, `…Response` DTO for outbound. Different shapes by design.
- Map with MapStruct, manual mapping, or records — pick one and be consistent.

```java
public record CreateOrderRequest(@NotNull UUID customerId, @NotEmpty List<@Valid LineItem> items) {}
public record OrderResponse(UUID id, UUID customerId, BigDecimal total, OrderStatus status, Instant createdAt) {}
```

Why: prevents accidental field exposure, decouples wire schema from DB schema, lets you evolve each side independently.

---

## Idempotency

- `GET`, `PUT`, `DELETE` are **idempotent** — same call N times has the same effect as 1 call. No surprises on retry.
- `POST` is **not** idempotent by default. For payments / order creation / anything where a duplicate is harmful, accept an `Idempotency-Key` header. Cache the response for 24h keyed on `(user, key)` and replay on duplicate.

```
POST /orders
Idempotency-Key: 0c7f3d8e-…-…-…
```

---

## OpenAPI / Swagger

Every endpoint **must** be documented in OpenAPI. No exceptions.

### Spring Boot — `springdoc-openapi`
```java
@Operation(summary = "Create order", description = "Creates a new order for the authenticated customer.")
@ApiResponses({
    @ApiResponse(responseCode = "201", description = "Created"),
    @ApiResponse(responseCode = "400", description = "Validation failed"),
    @ApiResponse(responseCode = "409", description = "Duplicate idempotency key")
})
@PostMapping("/orders")
public ResponseEntity<OrderResponse> create(@Valid @RequestBody CreateOrderRequest req) { … }
```

Generated spec is published at `/v3/api-docs` and rendered at `/swagger-ui.html`. Both are **disabled in prod** unless explicitly opened to internal networks.

---

## Spring Boot — Idiomatic Controller Shape

```java
@RestController
@RequestMapping("/api/v1/orders")
@Validated
public class OrderController {

    private final OrderService service;
    public OrderController(OrderService service) { this.service = service; }

    @GetMapping
    public Page<OrderResponse> list(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {
        return service.list(PageRequest.of(page, size));
    }

    @GetMapping("/{id}")
    public OrderResponse get(@PathVariable UUID id) {
        return service.get(id);
    }

    @PostMapping
    public ResponseEntity<OrderResponse> create(
            @Valid @RequestBody CreateOrderRequest req,
            @RequestHeader(value = "Idempotency-Key", required = false) UUID idempotencyKey) {
        OrderResponse created = service.create(req, idempotencyKey);
        return ResponseEntity
            .created(URI.create("/api/v1/orders/" + created.id()))
            .body(created);
    }

    @PatchMapping("/{id}")
    public OrderResponse patch(@PathVariable UUID id, @Valid @RequestBody UpdateOrderRequest req) {
        return service.update(id, req);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }
}
```

### Global Exception Handler
```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ErrorEnvelope> validation(MethodArgumentNotValidException ex) {
        List<ErrorDetail> details = ex.getBindingResult().getFieldErrors().stream()
            .map(fe -> new ErrorDetail(fe.getField(), fe.getDefaultMessage()))
            .toList();
        return ResponseEntity.badRequest()
            .body(new ErrorEnvelope("VALIDATION_FAILED", "Request validation failed", details, traceId()));
    }

    @ExceptionHandler(EntityNotFoundException.class)
    ResponseEntity<ErrorEnvelope> notFound(EntityNotFoundException ex) {
        return ResponseEntity.status(404)
            .body(new ErrorEnvelope("NOT_FOUND", ex.getMessage(), List.of(), traceId()));
    }

    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<ErrorEnvelope> denied(AccessDeniedException ex) {
        return ResponseEntity.status(403)
            .body(new ErrorEnvelope("FORBIDDEN", "Access denied", List.of(), traceId()));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ErrorEnvelope> any(Exception ex) {
        log.error("unhandled exception", ex);
        return ResponseEntity.status(500)
            .body(new ErrorEnvelope("INTERNAL", "Internal error", List.of(), traceId()));
    }
}
```

---

## Output Checklist

When designing an endpoint, confirm:
- [ ] Plural-noun resource path under `/api/v1/`
- [ ] Correct HTTP method, status code, and `Location` header on `201`
- [ ] Request and response DTOs (no entities exposed)
- [ ] `@Valid` on inbound DTO + bean-validation annotations
- [ ] Pagination on list endpoints, `size` capped
- [ ] Errors use the standard envelope and stable `code`s
- [ ] `Idempotency-Key` accepted for non-idempotent state changes that matter
- [ ] OpenAPI annotations + example requests/responses
- [ ] Authorization via `@PreAuthorize` or filter chain
- [ ] Resource ownership enforced server-side
