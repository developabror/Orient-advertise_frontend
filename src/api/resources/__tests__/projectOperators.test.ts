// Vitest unit tests for src/api/resources/projectOperators.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http', () => ({
  http: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import { http } from '../../http';
import {
  addProjectOperator,
  getProjectOperators,
  removeProjectOperator,
  setProjectOperators,
  type OperatorRef,
} from '../projectOperators';

const mockGet = http.get as unknown as ReturnType<typeof vi.fn>;
const mockPut = http.put as unknown as ReturnType<typeof vi.fn>;
const mockPost = http.post as unknown as ReturnType<typeof vi.fn>;
const mockDelete = http.delete as unknown as ReturnType<typeof vi.fn>;

const ref = (over: Partial<OperatorRef> = {}): OperatorRef => ({
  userId: 12,
  username: 'operator',
  assignedAt: '2026-06-01T10:00:00Z',
  assignedBy: 'admin',
  ...over,
});

const make409 = (message: string): unknown => ({
  isAxiosError: true,
  name: 'AxiosError',
  message: 'Request failed with status code 409',
  response: { status: 409, statusText: 'Conflict', data: { message }, headers: {}, config: {} },
  config: {},
  toJSON: () => ({}),
});

beforeEach(() => {
  mockGet.mockReset();
  mockPut.mockReset();
  mockPost.mockReset();
  mockDelete.mockReset();
});

afterEach(() => {
  mockGet.mockReset();
  mockPut.mockReset();
  mockPost.mockReset();
  mockDelete.mockReset();
});

describe('getProjectOperators', () => {
  it('GETs /api/projects/{id}/operators and parses OperatorRef[]', async () => {
    mockGet.mockResolvedValueOnce({ data: [ref(), ref({ userId: 13, username: 'op2' })] });

    const result = await getProjectOperators(4);

    expect(mockGet).toHaveBeenCalledWith('/api/projects/4/operators');
    expect(result).toEqual([ref(), ref({ userId: 13, username: 'op2' })]);
  });

  it('returns [] on a non-array body', async () => {
    mockGet.mockResolvedValueOnce({ data: { not: 'an array' } });
    expect(await getProjectOperators(4)).toEqual([]);
  });

  it('propagates a 404 unknown project unchanged', async () => {
    const err = { isAxiosError: true, response: { status: 404 } } as unknown;
    mockGet.mockRejectedValueOnce(err);
    await expect(getProjectOperators(99)).rejects.toBe(err);
  });
});

describe('setProjectOperators', () => {
  it('PUTs { userIds } and consumes the returned 200 OperatorRef[]', async () => {
    const resulting = [ref(), ref({ userId: 13, username: 'op2' })];
    mockPut.mockResolvedValueOnce({ data: resulting });

    const result = await setProjectOperators(4, [12, 13]);

    expect(mockPut).toHaveBeenCalledWith('/api/projects/4/operators', { userIds: [12, 13] });
    // Consumes the returned array, NOT a 204.
    expect(result).toEqual(resulting);
  });

  it('propagates a 409 (user not OPERATOR) unchanged', async () => {
    const err = make409('User 13 is not an OPERATOR');
    mockPut.mockRejectedValueOnce(err);
    await expect(setProjectOperators(4, [13])).rejects.toBe(err);
  });
});

describe('addProjectOperator', () => {
  it('POSTs the single-grant path with no body', async () => {
    mockPost.mockResolvedValueOnce({ data: undefined });
    await addProjectOperator(4, 12);
    expect(mockPost).toHaveBeenCalledWith('/api/projects/4/operators/12');
    expect(mockPost.mock.calls[0]).toHaveLength(1);
  });
});

describe('removeProjectOperator', () => {
  it('DELETEs idempotently', async () => {
    mockDelete.mockResolvedValueOnce({ data: undefined });
    await removeProjectOperator(4, 12);
    expect(mockDelete).toHaveBeenCalledWith('/api/projects/4/operators/12');
  });
});
