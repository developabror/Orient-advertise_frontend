// Vitest unit tests for src/api/resources/users.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import { http } from '../../http';
import {
  createUser,
  deleteUser,
  listUsers,
  type Role,
  type UserResponse,
} from '../users';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = http.post as unknown as ReturnType<typeof vi.fn>;
const mockDelete = http.delete as unknown as ReturnType<typeof vi.fn>;

const make409 = (message: string): unknown => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: 'Request failed with status code 409',
  response: {
    status: 409,
    statusText: 'Conflict',
    data: {
      status: 409,
      error: 'Conflict',
      message,
      correlationId: 'corr-409',
      timestamp: '2026-05-08T10:00:00Z',
    },
    headers: {},
    config: {},
  },
  config: {},
  toJSON: () => ({}),
});

const validUser = (over: Partial<UserResponse> = {}): UserResponse => ({
  id: 1,
  username: 'op1',
  role: 'OPERATOR',
  active: true,
  email: null,
  ...over,
});

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockDelete.mockReset();
});

afterEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockDelete.mockReset();
});

describe('listUsers', () => {
  it('GETs /api/users with the pageable params and parses the page envelope', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        content: [validUser({ id: 1 }), validUser({ id: 2, role: 'ADMIN' })],
        number: 0,
        size: 50,
        numberOfElements: 2,
        totalElements: 2,
        totalPages: 1,
        first: true,
        last: true,
      },
    });

    const page = await listUsers({ page: 0, size: 50, sort: 'username,asc' });

    expect(mockGet).toHaveBeenCalledWith('/api/users', {
      params: { page: 0, size: 50, sort: 'username,asc' },
    });
    expect(page.content).toHaveLength(2);
    expect(page.content[0]!.username).toBe('op1');
    expect(page.content[1]!.role).toBe('ADMIN');
  });

  it('preserves page: 0 (first Spring page) without dropping it as undefined', async () => {
    mockGet.mockResolvedValueOnce({ data: { content: [] } });

    await listUsers({ page: 0 });

    const params = (mockGet.mock.calls[0]![1] as { params: Record<string, unknown> }).params;
    expect(params.page).toBe(0);
    expect('size' in params).toBe(false);
    expect('sort' in params).toBe(false);
  });

  it('includes deactivated users (active: false) in the parsed content', async () => {
    mockGet.mockResolvedValueOnce({
      data: { content: [validUser({ id: 1, active: false })] },
    });

    const page = await listUsers({});
    expect(page.content[0]!.active).toBe(false);
  });

  it('drops rows with an unknown role and keeps well-formed siblings', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        content: [
          validUser({ id: 1 }),
          { id: 2, username: 'guest', role: 'GUEST', active: true }, // not in our union
          validUser({ id: 3 }),
        ],
        numberOfElements: 3,
        totalElements: 3,
      },
    });

    const page = await listUsers({});
    expect(page.content).toHaveLength(2);
    expect(page.content.map((u) => u.id)).toEqual([1, 3]);
    expect(page.numberOfElements).toBe(3);
  });

  it('parses a string email and coerces a missing one to null', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        content: [
          validUser({ id: 1, email: 'op1@example.com' }),
          { id: 2, username: 'op2', role: 'OPERATOR', active: true }, // no email on the wire
        ],
      },
    });

    const page = await listUsers({});
    expect(page.content[0]!.email).toBe('op1@example.com');
    expect(page.content[1]!.email).toBeNull();
  });

  it('drops rows with a non-boolean active flag', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        content: [
          validUser({ id: 1 }),
          { id: 2, username: 'op2', role: 'OPERATOR', active: 'yes' }, // wrong type
        ],
      },
    });

    const page = await listUsers({});
    expect(page.content).toHaveLength(1);
    expect(page.content[0]!.id).toBe(1);
  });
});

describe('createUser', () => {
  it('POSTs /api/users with the request body verbatim and returns the DTO', async () => {
    const created = validUser({ id: 99, username: 'newop', role: 'OPERATOR' });
    mockPost.mockResolvedValueOnce({ data: created });

    const body = { username: 'newop', password: 'p4ssw0rd!', role: 'OPERATOR' as Role };
    const dto = await createUser(body);

    expect(mockPost).toHaveBeenCalledWith('/api/users', body);
    // Two positional args (url + body) — no third per-request config.
    expect(mockPost.mock.calls[0]).toHaveLength(2);
    expect(dto).toBe(created);
  });

  it('passes every Role value through verbatim', async () => {
    const roles: readonly Role[] = ['ADMIN', 'OPERATOR', 'VIEWER', 'ADVERTISER'];
    for (const role of roles) {
      mockPost.mockResolvedValueOnce({ data: validUser({ role }) });
      await createUser({ username: 'u', password: 'p', role });
      const sent = mockPost.mock.calls.at(-1)![1] as { role: Role };
      expect(sent.role).toBe(role);
    }
    expect(mockPost).toHaveBeenCalledTimes(roles.length);
  });

  it('lets a 409 (duplicate username) axios error bubble unchanged for inline form rendering', async () => {
    const err = make409('Username already taken');
    mockPost.mockRejectedValueOnce(err);

    await expect(
      createUser({ username: 'taken', password: 'p', role: 'OPERATOR' }),
    ).rejects.toBe(err);

    const surface = err as { response?: { status?: number; data?: { message?: string } } };
    expect(surface.response?.status).toBe(409);
    expect(surface.response?.data?.message).toContain('already taken');
  });
});

describe('deleteUser', () => {
  it('sends DELETE /api/users/{userId} and resolves to undefined', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });

    const result = await deleteUser(7);

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith('/api/users/7');
    expect(result).toBeUndefined();
  });

  it('propagates 403 unchanged (non-ADMIN caller)', async () => {
    const err = {
      isAxiosError: true,
      name: 'AxiosError',
      message: 'Request failed with status code 403',
      response: { status: 403, statusText: 'Forbidden', data: {}, headers: {}, config: {} },
      config: {},
      toJSON: () => ({}),
    } as unknown;
    mockDelete.mockRejectedValueOnce(err);

    // The global response interceptor toasts 403 — we deliberately don't
    // suppress it for this destructive ADMIN-only endpoint.
    await expect(deleteUser(7)).rejects.toBe(err);
  });
});
