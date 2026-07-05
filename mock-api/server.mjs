// Orient Advertise — mock backend for the Vite SPA.
//
// Single-file Node 20 HTTP server. Holds seed data in memory; restarts reset
// state. Hand-rolled router (no Express) so the image stays tiny and there's
// no npm install step.
//
// Routes mirror the real backend's OpenAPI spec verbatim — same paths, same
// request/response shapes — so the SPA behaves identically against this mock
// or the real Spring service.
//
// Auth: any seeded username + the password "password" logs you in. JWT
// carries {sub, role, exp}; the frontend doesn't verify the signature.

import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 8080);
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN ?? 'http://localhost:3000';
const TOKEN_TTL_S = 3600;

// ---------------------------------------------------------------------------
// Seed data — uses spec field names so handler bodies are direct passthroughs.
// ---------------------------------------------------------------------------

const now = Date.now();
const isoAgo = (ms) => new Date(now - ms).toISOString();

let nextId = 1;
const id = () => nextId++;

const USERS = [
  { id: id(), username: 'admin', role: 'ADMIN', active: true, password: 'password' },
  { id: id(), username: 'operator', role: 'OPERATOR', active: true, password: 'password' },
  { id: id(), username: 'viewer', role: 'VIEWER', active: true, password: 'password' },
  { id: id(), username: 'advertiser', role: 'ADVERTISER', active: true, password: 'password' },
  { id: id(), username: 'advertiser2', role: 'ADVERTISER', active: false, password: 'password' },
];

const REGIONS = [
  { id: 1, name: 'Tashkent' },
  { id: 2, name: 'Samarkand' },
  { id: 3, name: 'Bukhara' },
];

// Device groups belong to a project (not a region) and span its regions.
// There are no device-group list/CRUD routes in this mock yet; the projectId
// tag just keeps the seed aligned with the new contract should they be added.
const GROUPS = [
  { id: 1, projectId: 1, name: 'Central Mall' },
  { id: 2, projectId: 1, name: 'East Mall' },
  { id: 3, projectId: 1, name: 'Airport Terminal' },
];

const FACILITIES = [
  'Central Mall',
  'East Mall',
  'Airport T1',
  'Airport T2',
  'Hotel Lobby',
  'Metro Plaza',
];

const DEVICES = (() => {
  const statuses = ['ONLINE', 'ONLINE', 'ONLINE', 'ONLINE', 'OFFLINE', 'NO_CONTENT'];
  const out = [];
  for (let i = 1; i <= 15; i++) {
    const region = REGIONS[i % REGIONS.length];
    const group = i <= 12 ? GROUPS[i % GROUPS.length] : null;
    out.push({
      id: i,
      serialNumber: `TVB-${String(i).padStart(5, '0')}`,
      name: `Display ${String(i)}`,
      computedStatus: statuses[i % statuses.length],
      regionId: region.id,
      facilityId: i % FACILITIES.length,
      facilityName: FACILITIES[i % FACILITIES.length],
      deviceGroupId: group?.id ?? null,
      lastHeartbeatAt: isoAgo(i * 90_000),
      currentContentVersion: `v${2025 + Math.floor(i / 5)}.${(i % 5) + 1}`,
    });
  }
  return out;
})();

const INCIDENTS = (() => {
  const priorities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  const statuses = ['OPEN', 'OPEN', 'ACKNOWLEDGED'];
  const out = [];
  for (let i = 1; i <= 12; i++) {
    const dev = DEVICES[i % DEVICES.length];
    const status = statuses[i % statuses.length];
    out.push({
      id: i,
      deviceId: dev.id,
      eventType: 'OFFLINE',
      status,
      priority: priorities[i % priorities.length],
      description: `Auto-detected anomaly on ${dev.facilityName}`,
      occurrenceCount: 1 + (i % 3),
      openedAt: isoAgo(i * 1800_000),
      updatedAt: isoAgo(i * 1800_000 - 600_000),
      acknowledgedAt: status !== 'OPEN' ? isoAgo(i * 1800_000 - 900_000) : null,
      acknowledgedBy: status !== 'OPEN' ? 'operator' : null,
      resolvedAt: null,
      resolvedBy: null,
    });
  }
  return out;
})();

const EVENTS = (() => {
  const types = [
    'DEVICE_ONLINE',
    'DEVICE_OFFLINE',
    'CONTENT_SYNC',
    'PLAYBACK_STARTED',
    'INCIDENT_CRITICAL',
  ];
  const priorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  const out = [];
  for (let i = 1; i <= 80; i++) {
    const dev = DEVICES[i % DEVICES.length];
    out.push({
      id: i,
      deviceId: dev.id,
      eventType: types[i % types.length],
      priority: priorities[i % priorities.length],
      payload: i % 3 === 0 ? `{"detail":"event ${String(i)}"}` : '',
      occurredAt: isoAgo(i * 600_000),
      createdAt: isoAgo(i * 600_000 - 60_000),
    });
  }
  return out;
})();

const CONTENT = (() => {
  const filenames = [
    'summer-promo.mp4',
    'holiday-sale.mp4',
    'spring-launch.mp4',
    'fall-collection.mp4',
    'winter-deals.mp4',
    'flash-sale.mp4',
    'brand-awareness.mp4',
    'product-demo.mp4',
  ];
  return filenames.map((name, i) => ({
    id: i + 1,
    name,
    status: i % 6 === 4 ? 'FAILED' : i % 6 === 5 ? 'INVALID' : 'READY',
  }));
})();

// userId -> Set<contentFileId>
const userContentLinks = new Map([
  [USERS[3].id, new Set([1, 2, 3])],
  [USERS[4].id, new Set([4])],
]);

// ---------------------------------------------------------------------------
// JWT (no signature verification on the FE)
// ---------------------------------------------------------------------------

const b64url = (s) => Buffer.from(s).toString('base64url');
const makeJwt = ({ sub, role }) => {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({ sub: String(sub), role, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_S }),
  );
  return `${header}.${payload}.mock-sig`;
};

// Refresh tokens — single-use uuids tracked per family. Issued at login;
// rotated on each refresh. Mirrors the spec behaviour.
const refreshFamilies = new Map(); // refreshTokenId -> { userId, familyId }
const issueRefresh = (userId, familyId = randomUUID()) => {
  const tokenId = randomUUID();
  refreshFamilies.set(tokenId, { userId, familyId });
  return tokenId;
};
const consumeRefresh = (tokenId) => {
  const meta = refreshFamilies.get(tokenId);
  if (!meta) return null;
  refreshFamilies.delete(tokenId);
  return meta;
};
const invalidateFamily = (familyId) => {
  for (const [k, v] of refreshFamilies) if (v.familyId === familyId) refreshFamilies.delete(k);
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const noContent = (res, status = 204) => {
  res.writeHead(status);
  res.end();
};
const errorEnvelope = (code, message) => ({
  error: { code, message, traceId: `mock-${Date.now()}` },
});

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
    });
    req.on('end', () => {
      if (!s) return resolve({});
      try {
        resolve(JSON.parse(s));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });

const intParam = (s, fallback = 0) => {
  const n = Number(s);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
};

// Spring Pageable wrapper.
const pageable = (arr, pageRaw, sizeRaw) => {
  const page = Math.max(0, intParam(pageRaw, 0));
  const size = Math.max(1, Math.min(100, intParam(sizeRaw, 20)));
  const start = page * size;
  const slice = arr.slice(start, start + size);
  return {
    content: slice,
    totalElements: arr.length,
    totalPages: Math.max(1, Math.ceil(arr.length / size)),
    size,
    number: page,
    numberOfElements: slice.length,
    first: page === 0,
    last: start + slice.length >= arr.length,
    empty: slice.length === 0,
    sort: { empty: true, sorted: false, unsorted: true },
    pageable: {
      offset: start,
      paged: true,
      pageNumber: page,
      pageSize: size,
      unpaged: false,
      sort: { empty: true, sorted: false, unsorted: true },
    },
  };
};

const applyCors = (req, res) => {
  const origin = req.headers.origin ?? ALLOW_ORIGIN;
  res.setHeader('Access-Control-Allow-Origin', origin);
  // Spec uses body-based refresh tokens; cookies aren't required, so
  // Allow-Credentials stays off (matches the FE's withCredentials: false).
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-API-Key');
  res.setHeader('Vary', 'Origin');
};

const userScrub = (u) => ({ id: u.id, username: u.username, role: u.role, active: u.active });

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

const handlers = [];
const route = (method, pattern, fn) => handlers.push({ method, pattern, fn });

// --- /auth ---
route('POST', /^\/auth\/login$/, async (req, res) => {
  const body = await readBody(req);
  const u = USERS.find((x) => x.username === body.username && body.password === x.password);
  if (!u)
    return json(res, 401, errorEnvelope('INVALID_CREDENTIALS', 'Invalid username or password.'));
  if (!u.active) return json(res, 401, errorEnvelope('USER_INACTIVE', 'Account is deactivated.'));
  const refreshToken = issueRefresh(u.id);
  return json(res, 200, { accessToken: makeJwt({ sub: u.id, role: u.role }), refreshToken });
});

route('POST', /^\/auth\/refresh$/, async (req, res) => {
  const body = await readBody(req);
  const consumed = consumeRefresh(body.refreshToken);
  if (!consumed)
    return json(
      res,
      401,
      errorEnvelope('TOKEN_INVALID', 'Refresh token unknown, expired, or replayed.'),
    );
  const u = USERS.find((x) => x.id === consumed.userId);
  if (!u || !u.active) {
    invalidateFamily(consumed.familyId);
    return json(res, 401, errorEnvelope('SESSION_EXPIRED', 'Session expired.'));
  }
  const refreshToken = issueRefresh(u.id, consumed.familyId);
  return json(res, 200, { accessToken: makeJwt({ sub: u.id, role: u.role }), refreshToken });
});

route('POST', /^\/auth\/logout$/, async (req, res) => {
  const body = await readBody(req);
  const meta = refreshFamilies.get(body.refreshToken);
  if (meta) invalidateFamily(meta.familyId);
  return noContent(res);
});

// --- /api/dashboard/summary ---
route('GET', /^\/api\/dashboard\/summary$/, async (_req, res) => {
  const totalDevices = DEVICES.length;
  const onlineCount = DEVICES.filter((d) => d.computedStatus === 'ONLINE').length;
  const offlineCount = DEVICES.filter((d) => d.computedStatus === 'OFFLINE').length;
  const noContentCount = DEVICES.filter((d) => d.computedStatus === 'NO_CONTENT').length;
  const critical = INCIDENTS.filter(
    (i) => i.priority === 'CRITICAL' && i.status !== 'RESOLVED',
  ).length;
  const warning = INCIDENTS.filter((i) => i.priority === 'HIGH' && i.status !== 'RESOLVED').length;
  const regionSummary = REGIONS.map((r) => ({
    regionId: r.id,
    regionName: r.name,
    onlineCount: DEVICES.filter((d) => d.regionId === r.id && d.computedStatus === 'ONLINE').length,
    totalCount: DEVICES.filter((d) => d.regionId === r.id).length,
  }));
  return json(res, 200, {
    totalDevices,
    onlineCount,
    offlineCount,
    noContentCount,
    openIncidents: { critical, warning },
    regionSummary,
  });
});

// --- /api/devices ---
route('GET', /^\/api\/devices$/, async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let arr = [...DEVICES];
  const status = url.searchParams.get('status');
  const regionId = url.searchParams.get('regionId');
  const facilityName = url.searchParams.get('facilityName');
  if (status) arr = arr.filter((d) => d.computedStatus === status);
  if (regionId) arr = arr.filter((d) => String(d.regionId) === regionId);
  if (facilityName)
    arr = arr.filter((d) => d.facilityName.toLowerCase().includes(facilityName.toLowerCase()));
  return json(res, 200, pageable(arr, url.searchParams.get('page'), url.searchParams.get('size')));
});

route('GET', /^\/api\/devices\/(\d+)$/, async (_req, res, [, idStr]) => {
  const d = DEVICES.find((x) => x.id === Number(idStr));
  if (!d) return json(res, 404, errorEnvelope('NOT_FOUND', 'Device not found.'));
  return json(res, 200, {
    id: d.id,
    serialNumber: d.serialNumber,
    name: d.name,
    status: d.computedStatus,
    regionId: d.regionId,
    facilityId: d.facilityId,
    deviceGroupId: d.deviceGroupId,
    lastHeartbeatAt: d.lastHeartbeatAt,
    registeredAt: isoAgo(30 * 86_400_000),
    createdAt: isoAgo(30 * 86_400_000),
    updatedAt: isoAgo(86_400_000),
    deletedAt: null,
    deleted: false,
  });
});

route('GET', /^\/api\/devices\/(\d+)\/diagnostics$/, async (_req, res, [, idStr]) => {
  const d = DEVICES.find((x) => x.id === Number(idStr));
  if (!d) return json(res, 404, errorEnvelope('NOT_FOUND', 'Device not found.'));
  return json(res, 200, {
    deviceId: d.id,
    serialNumber: d.serialNumber,
    name: d.name,
    status: d.computedStatus,
    lastHeartbeatAt: d.lastHeartbeatAt,
    currentContentVersion: d.currentContentVersion,
    lastKnownIp: '10.0.0.42',
    pendingActionCount: 0,
    recentEvents: EVENTS.filter((e) => e.deviceId === d.id)
      .slice(0, 5)
      .map((e) => ({
        id: e.id,
        eventType: e.eventType,
        priority: e.priority,
        payload: e.payload,
        occurredAt: e.occurredAt,
      })),
    recentActions: [],
    generatedAt: new Date().toISOString(),
  });
});

route('POST', /^\/api\/devices\/(\d+)\/actions$/, async (_req, res) =>
  json(res, 200, {
    actionId: id(),
    deviceId: 0,
    actionType: 'PENDING',
    status: 'PENDING',
    payload: '',
    issuedAt: new Date().toISOString(),
    expiresAt: isoAgo(-3600_000),
    issuedBy: 'mock',
  }),
);

route('POST', /^\/api\/device-groups\/(\d+)\/actions$/, async (req, res, [, idStr]) => {
  const groupId = Number(idStr);
  const total = DEVICES.filter((d) => d.deviceGroupId === groupId).length || 5;
  const failed = Math.random() < 0.2 ? 1 : 0;
  const skipped = Math.random() < 0.15 ? 1 : 0;
  const succeeded = Math.max(0, total - failed - skipped);
  return json(res, 200, {
    deviceGroupId: groupId,
    actionType: (await readBody(req)).actionType ?? 'UNKNOWN',
    totalDevices: total,
    succeededCount: succeeded,
    skippedCount: skipped,
    failedCount: failed,
    succeededActionIds: Array.from({ length: succeeded }, () => id()),
    skipped: skipped > 0 ? [{ deviceId: 99, reason: 'OFFLINE' }] : [],
    failed: failed > 0 ? [{ deviceId: 98, reason: 'TIMEOUT' }] : [],
  });
});

// --- /api/incidents ---
route('GET', /^\/api\/incidents\/open$/, async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const priority = url.searchParams.get('priority');
  let arr = INCIDENTS.filter((i) => i.status !== 'RESOLVED');
  if (priority) arr = arr.filter((i) => i.priority === priority.toUpperCase());
  return json(res, 200, arr);
});

route('POST', /^\/api\/incidents\/(\d+)\/acknowledge$/, async (_req, res, [, idStr]) => {
  const inc = INCIDENTS.find((x) => x.id === Number(idStr));
  if (inc) {
    inc.status = 'ACKNOWLEDGED';
    inc.acknowledgedAt = new Date().toISOString();
    inc.acknowledgedBy = 'admin';
  }
  return json(res, 200, inc ?? {});
});

route('POST', /^\/api\/incidents\/(\d+)\/resolve$/, async (_req, res, [, idStr]) => {
  const inc = INCIDENTS.find((x) => x.id === Number(idStr));
  if (inc) {
    inc.status = 'RESOLVED';
    inc.resolvedAt = new Date().toISOString();
    inc.resolvedBy = 'admin';
  }
  return json(res, 200, inc ?? {});
});

// --- /api/events ---
route('GET', /^\/api\/events$/, async (req, res) => {
  const url = new URL(req.url, 'http://x');
  return json(
    res,
    200,
    pageable(EVENTS, url.searchParams.get('page'), url.searchParams.get('size')),
  );
});

// --- /api/users (admin) ---
// Spec: GET only takes `pageable` (page/size/sort).
route('GET', /^\/api\/users$/, async (req, res) => {
  const url = new URL(req.url, 'http://x');
  return json(
    res,
    200,
    pageable(USERS.map(userScrub), url.searchParams.get('page'), url.searchParams.get('size')),
  );
});

route('POST', /^\/api\/users$/, async (req, res) => {
  const body = await readBody(req);
  if (!body.username || !body.role)
    return json(res, 400, errorEnvelope('VALIDATION', 'username and role required'));
  if (USERS.some((u) => u.username === body.username)) {
    return json(res, 409, errorEnvelope('USERNAME_TAKEN', 'Username already exists.'));
  }
  const u = {
    id: id(),
    username: body.username,
    role: body.role,
    active: true,
    password: body.password ?? 'password',
  };
  USERS.push(u);
  // Spec: 201 with NO body.
  res.writeHead(201);
  res.end();
});

route('DELETE', /^\/api\/users\/(\d+)$/, async (_req, res, [, idStr]) => {
  const i = USERS.findIndex((u) => u.id === Number(idStr));
  if (i < 0) return json(res, 404, errorEnvelope('NOT_FOUND', 'Unknown user'));
  USERS.splice(i, 1);
  userContentLinks.delete(Number(idStr));
  return noContent(res);
});

route('GET', /^\/api\/users\/(\d+)\/content$/, async (_req, res, [, idStr]) => {
  const set = userContentLinks.get(Number(idStr)) ?? new Set();
  return json(
    res,
    200,
    CONTENT.filter((c) => set.has(c.id)),
  );
});

route('POST', /^\/api\/users\/(\d+)\/content\/(\d+)$/, async (_req, res, [, uid, cid]) => {
  const u = USERS.find((x) => x.id === Number(uid));
  const c = CONTENT.find((x) => x.id === Number(cid));
  if (!u || !c) return json(res, 404, errorEnvelope('NOT_FOUND', 'Unknown user or content'));
  let set = userContentLinks.get(Number(uid));
  if (!set) {
    set = new Set();
    userContentLinks.set(Number(uid), set);
  }
  set.add(Number(cid));
  return json(res, 200, {});
});

route('DELETE', /^\/api\/users\/(\d+)\/content\/(\d+)$/, async (_req, res, [, uid, cid]) => {
  userContentLinks.get(Number(uid))?.delete(Number(cid));
  return json(res, 200, {});
});

// --- /api/stats/content/{contentFileId} ---
route('GET', /^\/api\/stats\/content\/(\d+)$/, async (req, res, [, idStr]) => {
  const url = new URL(req.url, 'http://x');
  const c = CONTENT.find((x) => x.id === Number(idStr));
  if (!c) return json(res, 404, errorEnvelope('NOT_FOUND', 'Content not found.'));
  const perDevice = DEVICES.slice(0, 6).map((d, i) => ({
    deviceId: d.id,
    deviceName: d.facilityName,
    playCount: 30 - i * 4,
  }));
  const totalPlayCount = perDevice.reduce((s, r) => s + r.playCount, 0);
  // Synthesise timestamp page from totalPlayCount.
  const tsAll = [];
  for (let i = 0; i < Math.min(totalPlayCount, 240); i++) tsAll.push(isoAgo(i * 1800_000));
  const page = intParam(url.searchParams.get('page'), 0);
  const size = Math.max(1, Math.min(100, intParam(url.searchParams.get('size'), 50)));
  const start = page * size;
  const slice = tsAll.slice(start, start + size);
  return json(res, 200, {
    contentFileId: c.id,
    contentFileName: c.name,
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    totalPlayCount,
    perDevice,
    timestampsIncluded: true,
    timestamps: {
      content: slice,
      page,
      size,
      totalElements: tsAll.length,
      totalPages: Math.max(1, Math.ceil(tsAll.length / size)),
    },
  });
});

// --- /api/reports/* ---
route('GET', /^\/api\/reports\/events$/, async (req, res) => {
  const url = new URL(req.url, 'http://x');
  return json(res, 200, {
    status: 'COMPLETED',
    facilityId: intParam(url.searchParams.get('facilityId'), null),
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
    totalEvents: EVENTS.length,
    countsByType: { OFFLINE: 30, SYNC_TIMEOUT: 12 },
    incidentCount: INCIDENTS.length,
    avgResolutionSeconds: 1800,
    topAffectedDevices: DEVICES.slice(0, 3).map((d) => ({
      deviceId: d.id,
      deviceName: d.facilityName,
      eventCount: 30,
    })),
  });
});

route('GET', /^\/api\/reports\/export$/, async (_req, res) => {
  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="orient-report.xlsx"',
  });
  res.end('mock-xlsx-bytes');
});

// --- /api/health ---
route('GET', /^\/api\/health$/, async (_req, res) =>
  json(res, 200, {
    overallStatus: 'UP',
    components: [{ name: 'mock', status: 'UP', timestamp: new Date().toISOString() }],
  }),
);

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return noContent(res);

  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname;

  // Container healthcheck — kept stable so docker-compose doesn't churn.
  if (req.method === 'GET' && pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  for (const h of handlers) {
    if (h.method !== req.method) continue;
    const m = h.pattern.exec(pathname);
    if (!m) continue;
    try {
      return await h.fn(req, res, m);
    } catch (err) {
      console.error('handler error:', err);
      return json(res, 500, errorEnvelope('INTERNAL', String(err?.message ?? err)));
    }
  }
  return json(res, 404, errorEnvelope('NOT_FOUND', `No mock for ${req.method} ${pathname}`));
});

server.listen(PORT, () => {
  console.log(`mock-api listening on :${PORT} (CORS allow-origin: ${ALLOW_ORIGIN})`);
  console.log('demo creds — password is "password"');
  for (const u of USERS) console.log(`  ${u.role.padEnd(11)} ${u.username}`);
});
