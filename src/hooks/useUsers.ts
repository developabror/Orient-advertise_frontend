import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { http } from '@api/http';
import { extractApiMessage } from '@api';
import { markErrorHandled } from '@api/errorDialog';
import type { Role } from '@api/auth';

// Spec models the user as `active: boolean`. We keep a string type for the
// existing UI rendering layer (badges, filtering) and derive it from `active`
// in the sanitiser.
export type UserStatus = 'active' | 'inactive';

// Backend UserResponse: { id, username, role, active }. Other fields the FE
// surfaces (email, lastLoginAt, linkedContentCount) aren't part of the spec —
// they're filled with safe defaults so the table still renders.
export interface UserRecord {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly status: UserStatus;
  readonly lastLoginAt: string | null;
  readonly linkedContentCount: number;
}

// Spec's only filterable parameter is `pageable` — there is no q/role/status
// server-side filtering. The hook accepts these for backwards compatibility
// with the page UI but applies them client-side over the current page.
export interface UsersQuery {
  readonly page: number;
  readonly size: number;
  readonly q: string;
  readonly role: '' | Role;
  readonly status: '' | UserStatus;
}

export interface CreateUserInput {
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly password: string;
}

// Spec's CreateUserRequest body shape — what we actually send. `email` is
// optional on the wire but the backend persists it when present; sending it is
// what makes "Forgot password" usable for a freshly-created account.
interface CreateUserRequestBody {
  readonly username: string;
  readonly password: string;
  readonly role: 'ADMIN' | 'OPERATOR' | 'VIEWER' | 'ADVERTISER';
  readonly email?: string;
}

export type CreateUserError =
  | { readonly code: 'EMAIL_TAKEN'; readonly message: string }
  | { readonly code: 'VALIDATION'; readonly message: string }
  | { readonly code: 'NETWORK'; readonly message: string }
  | { readonly code: 'UNKNOWN'; readonly message: string };

export class CreateUserFailure extends Error {
  readonly detail: CreateUserError;
  constructor(detail: CreateUserError) {
    super(detail.message);
    this.detail = detail;
    this.name = 'CreateUserFailure';
  }
}

export interface UseUsersResult {
  readonly items: readonly UserRecord[];
  readonly totalItems: number;
  readonly totalPages: number;
  readonly isLoading: boolean;
  readonly isStale: boolean;
  readonly error: string | null;
  readonly retry: () => void;
  readonly create: (input: CreateUserInput) => Promise<void>;
  // Spec exposes only `DELETE /api/users/{userId}` — there is no
  // active/inactive toggle endpoint. The previous `setStatus` was renamed to
  // `remove` to match the actual destructive semantic.
  readonly remove: (id: string) => Promise<void>;
}

const ROLE_TO_API: Record<Role, CreateUserRequestBody['role']> = {
  admin: 'ADMIN',
  operator: 'OPERATOR',
  viewer: 'VIEWER',
  advertiser: 'ADVERTISER',
};

const mapRoleFromApi = (raw: unknown): Role | null => {
  if (typeof raw !== 'string') return null;
  const v = raw.toUpperCase();
  if (v === 'ADMIN') return 'admin';
  if (v === 'OPERATOR') return 'operator';
  if (v === 'VIEWER') return 'viewer';
  if (v === 'ADVERTISER') return 'advertiser';
  return null;
};

const idStr = (v: unknown): string | null => {
  if (typeof v === 'string' && v !== '') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};

// Spec UserResponse: { id (number), username, role (UPPERCASE), active }.
// No email / lastLoginAt / linkedContentCount on the wire — defaulted.
const sanitizeUser = (v: unknown): UserRecord | null => {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const id = idStr(r.id);
  if (id === null) return null;
  const role = mapRoleFromApi(r.role);
  if (role === null) return null;
  const username = typeof r.username === 'string' && r.username !== '' ? r.username : id;
  return {
    id,
    name: username,
    // The backend now persists `email`; surface the real wire value and fall
    // back to '' when the row has none on file.
    email: typeof r.email === 'string' ? r.email : '',
    role,
    status: r.active === false ? 'inactive' : 'active',
    lastLoginAt: null,
    linkedContentCount: 0,
  };
};

interface ParsedPage {
  readonly items: readonly UserRecord[];
  readonly totalItems: number;
  readonly totalPages: number;
}

// Spec returns Spring PageUserResponse: `content[]`, `totalElements`,
// `totalPages`, `size`, `number`. Tolerate the older `data`/`totalItems`
// envelope as a fallback so a backend swap doesn't break us mid-flight.
const sanitizeList = (data: unknown, size: number): ParsedPage => {
  if (typeof data !== 'object' || data === null) {
    return { items: [], totalItems: 0, totalPages: 0 };
  }
  const v = data as Record<string, unknown>;
  let arr: unknown[] = [];
  if (Array.isArray(v.content)) arr = v.content;
  else if (Array.isArray(v.data)) arr = v.data;
  else if (Array.isArray(data)) arr = data;
  const items: UserRecord[] = [];
  for (const e of arr) {
    const parsed = sanitizeUser(e);
    if (parsed) items.push(parsed);
  }
  const totalItems =
    typeof v.totalElements === 'number' && Number.isFinite(v.totalElements)
      ? Math.max(0, Math.floor(v.totalElements))
      : typeof v.totalItems === 'number' && Number.isFinite(v.totalItems)
        ? Math.max(0, Math.floor(v.totalItems))
        : items.length;
  const totalPages =
    typeof v.totalPages === 'number' && Number.isFinite(v.totalPages)
      ? Math.max(0, Math.floor(v.totalPages))
      : Math.max(1, Math.ceil(totalItems / Math.max(1, size)));
  return { items, totalItems, totalPages };
};

export const useUsers = (query: UsersQuery): UseUsersResult => {
  const [items, setItems] = useState<readonly UserRecord[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isStale, setIsStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    // Spec: only `pageable` (page/size/sort) is accepted. Server-side
    // filtering by q/role/status isn't defined — we apply those client-side
    // over the page we receive.
    http
      .get<unknown>('/api/users', {
        params: { page: Math.max(0, query.page - 1), size: query.size },
        signal: controller.signal,
        _suppressErrorToast: true,
      })
      .then(({ data }) => {
        if (cancelled || controller.signal.aborted) return;
        const parsed = sanitizeList(data, query.size);
        setItems(parsed.items);
        setTotalItems(parsed.totalItems);
        setTotalPages(parsed.totalPages);
        setIsStale(false);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted || axios.isCancel(err)) return;
        setIsStale(true);
        setError('Could not load users.');
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [query.page, query.size, refreshKey]);

  const retry = useCallback((): void => {
    setRefreshKey((k) => k + 1);
  }, []);

  // POST /api/users body { username, password, role } → 201 with the
  // created user as the response body. We don't read the body here (we
  // refresh the page to pick the new row up via the same paged fetch
  // every other consumer uses), but it IS present — don't add new
  // callers that assume "no body".
  const create = useCallback(async (input: CreateUserInput): Promise<void> => {
    const body: CreateUserRequestBody = {
      username: input.name.trim() !== '' ? input.name.trim() : input.email,
      password: input.password,
      role: ROLE_TO_API[input.role],
      email: input.email.trim(),
    };
    try {
      await http.post('/api/users', body, { _suppressErrorToast: true });
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      if (err instanceof CreateUserFailure) throw err;
      // CreateUserModal renders this message inline, so claim the error to stop
      // the global modal double-popping the same 4xx.
      markErrorHandled(err);
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        if (status === 409) {
          throw new CreateUserFailure({
            code: 'EMAIL_TAKEN',
            message: extractApiMessage(err) ?? 'A user with that username already exists.',
          });
        }
        if (status === 400 || status === 422) {
          throw new CreateUserFailure({
            code: 'VALIDATION',
            message: 'The form has validation errors. Please check the fields.',
          });
        }
        if (status === undefined) {
          throw new CreateUserFailure({
            code: 'NETWORK',
            message: 'Could not reach the server. Check your connection.',
          });
        }
      }
      throw new CreateUserFailure({
        code: 'UNKNOWN',
        message: 'Could not create user. Please try again.',
      });
    }
  }, []);

  // Spec: DELETE /api/users/{userId} → 204 (cascades content access for
  // ADVERTISERs). Optimistic remove from the visible list; revert on failure.
  const remove = useCallback(
    async (id: string): Promise<void> => {
      const previous = items;
      setItems((curr) => curr.filter((u) => u.id !== id));
      setTotalItems((n) => Math.max(0, n - 1));
      try {
        await http.delete(`/api/users/${encodeURIComponent(id)}`, {
          _suppressErrorToast: true,
        });
      } catch (err) {
        setItems(previous);
        setTotalItems(previous.length);
        throw err;
      }
    },
    [items],
  );

  return {
    items,
    totalItems,
    totalPages,
    isLoading,
    isStale,
    error,
    retry,
    create,
    remove,
  };
};
