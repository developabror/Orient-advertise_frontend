import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { http } from '@api/http';
import { getUser, type UserDetailResponse } from '@api/resources/users';
import type { Role } from '@api/auth';
import type { ContentItem, ContentStatus } from './useContentItems';
import type { UserRecord } from './useUsers';

export interface UseOperatorAccessResult {
  readonly user: UserRecord | null;
  readonly userLoading: boolean;
  readonly userError: string | null;
  readonly notFound: boolean;
  readonly linked: readonly ContentItem[];
  readonly linkedLoading: boolean;
  readonly linkedError: string | null;
  readonly retry: () => void;
  readonly link: (contentId: string) => Promise<ContentItem>;
  readonly unlink: (contentId: string) => Promise<void>;
}

const isStatus = (v: unknown): v is ContentStatus =>
  v === 'ready' || v === 'transcoding' || v === 'failed' || v === 'invalid' || v === 'uploading';

const safeNumber = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
};

// Map the backend uppercase Role onto the FE's lowercase routing role.
// `advertiser` is the safe fallback because this page is the advertiser-
// access detail surface — an unknown role string still reads "advertiser"
// in the header rather than throwing the page out.
const mapRoleToFe = (raw: string): Role => {
  switch (raw.toUpperCase()) {
    case 'ADMIN':
      return 'admin';
    case 'OPERATOR':
      return 'operator';
    case 'VIEWER':
      return 'viewer';
    case 'ADVERTISER':
    default:
      return 'advertiser';
  }
};

const userDetailToRecord = (u: UserDetailResponse): UserRecord => ({
  id: String(u.id),
  name: u.username,
  // UserDetailResponse doesn't carry email / lastLoginAt / linkedContent
  // count today; defaults below keep the page header rendering without
  // fabricating values the backend doesn't actually track.
  email: '',
  role: mapRoleToFe(u.role),
  status: u.active ? 'active' : 'inactive',
  lastLoginAt: null,
  linkedContentCount: 0,
});

const sanitizeContent = (v: unknown): ContentItem | null => {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  // Spec LinkedContent: { id (number), name, status }. Other fields the FE
  // surfaces (durationSeconds, sizeBytes, progressPct, urgent, errorMessage)
  // aren't on the wire here — defaults below keep the row shape compatible
  // with the rest of the access UI without faking values.
  const id = typeof r.id === 'string' ? r.id : typeof r.id === 'number' ? String(r.id) : null;
  if (id === null) return null;
  const filename =
    typeof r.name === 'string' && r.name !== ''
      ? r.name
      : typeof r.filename === 'string'
        ? r.filename
        : id;
  // Backend `status` is uppercase free-form (READY/TRANSCODING/...). The FE
  // ContentStatus is lowercase; map case-insensitively and fall back to
  // 'ready' when the value is one we don't recognise — the access UI doesn't
  // depend on a fine-grained breakdown beyond the warning badges.
  const rawStatus = typeof r.status === 'string' ? r.status.toLowerCase() : 'ready';
  const status: ContentStatus = isStatus(rawStatus) ? rawStatus : 'ready';
  return {
    id,
    filename,
    durationSeconds: safeNumber(r.durationSeconds),
    sizeBytes: safeNumber(r.sizeBytes),
    status,
    progressPct: 100,
    urgent: false,
    assignedTo: 0,
    errorMessage: null,
    thumbnailUrl: typeof r.thumbnailUrl === 'string' ? r.thumbnailUrl : null,
    uploadedByUsername: typeof r.uploadedByUsername === 'string' ? r.uploadedByUsername : null,
    canManage: typeof r.canManage === 'boolean' ? r.canManage : false,
  };
};

const sanitizeContentList = (data: unknown): readonly ContentItem[] => {
  let arr: unknown[] = [];
  if (Array.isArray(data)) arr = data;
  else if (typeof data === 'object' && data !== null) {
    const inner = (data as Record<string, unknown>).data;
    if (Array.isArray(inner)) arr = inner;
  }
  const out: ContentItem[] = [];
  for (const e of arr) {
    const parsed = sanitizeContent(e);
    if (parsed) out.push(parsed);
  }
  return out;
};

export const useOperatorAccess = (userId: string): UseOperatorAccessResult => {
  const [user, setUser] = useState<UserRecord | null>(null);
  const [userLoading, setUserLoading] = useState(true);
  const [userError, setUserError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [linked, setLinked] = useState<readonly ContentItem[]>([]);
  const [linkedLoading, setLinkedLoading] = useState(true);
  const [linkedError, setLinkedError] = useState<string | null>(null);

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (userId === '') return;
    let cancelled = false;
    const controller = new AbortController();
    setUser(null);
    setUserLoading(true);
    setUserError(null);
    setNotFound(false);
    setLinkedLoading(true);
    setLinkedError(null);

    const numericUserId = Number.parseInt(userId, 10);
    const loadUser = !Number.isFinite(numericUserId)
      ? Promise.resolve().then(() => {
          if (cancelled) return;
          setNotFound(true);
          setUserLoading(false);
        })
      : getUser(numericUserId)
          .then((detail) => {
            if (cancelled) return;
            setUser(userDetailToRecord(detail));
            setUserLoading(false);
          })
          .catch((err: unknown) => {
            if (cancelled || axios.isCancel(err)) return;
            if (axios.isAxiosError(err) && err.response?.status === 404) {
              setNotFound(true);
              setUser(null);
            } else {
              setUserError('Could not load user.');
            }
            setUserLoading(false);
          });

    const loadLinked = http
      .get<unknown>(`/api/users/${encodeURIComponent(userId)}/operator-content`, {
        signal: controller.signal,
        _suppressErrorToast: true,
      })
      .then(({ data }) => {
        if (cancelled || controller.signal.aborted) return;
        setLinked(sanitizeContentList(data));
        setLinkedLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted || axios.isCancel(err)) return;
        setLinkedError('Could not load linked content.');
        setLinkedLoading(false);
      });

    void Promise.all([loadUser, loadLinked]);

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [userId, refreshKey]);

  const retry = useCallback((): void => {
    setRefreshKey((k) => k + 1);
  }, []);

  const link = useCallback(
    async (contentId: string): Promise<ContentItem> => {
      // Spec: POST /api/users/{userId}/operator-content/{contentFileId} — no body.
      await http.post(
        `/api/users/${encodeURIComponent(userId)}/operator-content/${encodeURIComponent(contentId)}`,
        undefined,
        { _suppressErrorToast: true },
      );
      // Endpoint returns no content payload; stub a minimal row so the UI
      // updates immediately. The next refetch corrects metadata.
      const stub: ContentItem = {
        id: contentId,
        filename: contentId,
        durationSeconds: 0,
        sizeBytes: 0,
        status: 'ready',
        progressPct: 100,
        urgent: false,
        assignedTo: 0,
        errorMessage: null,
        thumbnailUrl: null,
        uploadedByUsername: null,
        canManage: false,
      };
      setLinked((curr) => (curr.some((c) => c.id === stub.id) ? curr : [...curr, stub]));
      return stub;
    },
    [userId],
  );

  const unlink = useCallback(
    async (contentId: string): Promise<void> => {
      await http.delete(
        `/api/users/${encodeURIComponent(userId)}/operator-content/${encodeURIComponent(contentId)}`,
        { _suppressErrorToast: true },
      );
      setLinked((curr) => curr.filter((c) => c.id !== contentId));
    },
    [userId],
  );

  return {
    user,
    userLoading,
    userError,
    notFound,
    linked,
    linkedLoading,
    linkedError,
    retry,
    link,
    unlink,
  };
};
