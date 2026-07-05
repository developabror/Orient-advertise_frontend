import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import {
  Button,
  type Column,
  ConfirmDialog,
  Drawer,
  FormInput,
  EmptyState,
  Modal,
  Pagination,
  RoleGate,
  SearchInput,
  Select,
  Spinner,
  Table,
} from '@components';
import {
  addPlaylistItem,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  isErrorResponse,
  listContent,
  listPlaylists,
  listProjects,
  removePlaylistItem,
  renamePlaylist,
  reorderPlaylistItems,
  setItemDurationOverride,
  type ContentFileSummary,
  type PlaylistDetail,
  type PlaylistItemDto,
  type PlaylistSummary,
  type ProjectSummary,
} from '@api';
import { markErrorHandled } from '@api/errorDialog';
import { notify } from '@api/notify';
import { useRole } from '@hooks/useRole';
import { useAssignedProjects } from '@hooks/useAssignedProjects';
import { formatTimestamp, isSameOrder, moveItemByIndex } from './playlistsPage.helpers';

const PAGE_SIZE = 20;
const CONTENT_PAGE_SIZE = 50;
const NAME_DEBOUNCE_MS = 300;

const extractMessage = (err: unknown): string | null => {
  // This page renders the backend message inline, so claim the error to stop
  // the global error-dialog interceptor from also surfacing it as a modal.
  // Harmless no-op for the GET load failures that also pass through here —
  // only operator-initiated mutation 4xx are ever modal-eligible.
  markErrorHandled(err);
  if (!axios.isAxiosError(err)) return null;
  const data: unknown = err.response?.data;
  if (isErrorResponse(data)) return data.message;
  return null;
};

const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m)}:${s.toString().padStart(2, '0')}`;
};

// Per-item dwell / duration override range. Matches the backend
// `PlaylistItemService.setDuration` bounds [1, 86400] seconds; we validate
// client-side so an out-of-range value never reaches the API.
const MIN_DWELL = 1;
const MAX_DWELL = 86400;

const isImageContentType = (contentType: string): boolean =>
  contentType.toLowerCase().startsWith('image/');

// The seconds value currently persisted for a row: the override when set,
// else the source file's natural duration (only when it's a real, positive
// number). An image (no natural duration) with no override resolves to null —
// i.e. effective duration 0, the bug this editor prevents.
const persistedDwell = (item: PlaylistItemDto): number | null =>
  item.durationOverride ?? (item.durationSeconds > 0 ? item.durationSeconds : null);

interface DurationCellProps {
  readonly item: PlaylistItemDto;
  readonly playlistId: number;
  readonly canEdit: boolean;
  readonly disabled: boolean;
  readonly onCommitted: () => void;
  readonly onError: (msg: string) => void;
  readonly onClearError: () => void;
}

/**
 * Inline seconds editor for a single playlist item's dwell / duration.
 *
 * An item whose source file has no natural duration (`durationSeconds <= 0`)
 * is an **image**: its dwell time is operator-set and MANDATORY — clearing it
 * would leave the item at effective duration 0 (it would never display). Such
 * a row must carry a positive override; the cell blocks an empty save and
 * shows a warning badge while the effective duration is still 0.
 *
 * Videos (natural duration > 0) may clear their override to fall back to the
 * source duration. The write is optimistic: the typed value shows immediately,
 * a failed PUT rolls the input back to the last persisted value, surfaces the
 * backend message inline, and toasts.
 */
const DurationCell = ({
  item,
  playlistId,
  canEdit,
  disabled,
  onCommitted,
  onError,
  onClearError,
}: DurationCellProps) => {
  const { t } = useTranslation();
  const isImage = item.durationSeconds <= 0;
  const effective = item.durationOverride ?? item.durationSeconds;
  const warnZero = effective <= 0;
  const server = persistedDwell(item);

  const [draft, setDraft] = useState<string>(server !== null ? String(server) : '');
  const [saving, setSaving] = useState<boolean>(false);
  const [localError, setLocalError] = useState<boolean>(false);

  // Re-sync the input to the persisted value whenever the row's duration
  // fields change (e.g. after a successful save refreshes the drawer). Not
  // fired on a failed save (the row is unchanged) — that rollback is explicit.
  useEffect(() => {
    const sv = item.durationOverride ?? (item.durationSeconds > 0 ? item.durationSeconds : null);
    setDraft(sv !== null ? String(sv) : '');
    setLocalError(false);
  }, [item.durationOverride, item.durationSeconds]);

  const fail = (msg: string): void => {
    setLocalError(true);
    onError(msg);
  };

  const save = (value: number | null): void => {
    setSaving(true);
    setLocalError(false);
    onClearError();
    setItemDurationOverride(playlistId, item.id, value)
      .then(() => {
        onCommitted();
      })
      .catch((err: unknown) => {
        // Roll the optimistic input back to the last persisted value.
        setDraft(server !== null ? String(server) : '');
        const msg = extractMessage(err) ?? t('playlistsPage.errSetDuration');
        fail(msg);
        notify.error(msg);
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const commit = (): void => {
    if (!canEdit || disabled || saving) return;
    const trimmed = draft.trim();

    if (trimmed === '') {
      if (isImage) {
        // An image can't fall back to a natural duration — a dwell is required.
        fail(t('playlistsPage.dwellRequired'));
        return;
      }
      if (item.durationOverride === null) {
        // Nothing to clear.
        onClearError();
        setLocalError(false);
        return;
      }
      save(null);
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < MIN_DWELL || parsed > MAX_DWELL) {
      fail(t('playlistsPage.dwellRange', { min: MIN_DWELL, max: MAX_DWELL }));
      return;
    }
    // Value unchanged from the existing override → nothing to do.
    if (parsed === item.durationOverride) {
      onClearError();
      setLocalError(false);
      return;
    }
    // For a video, a value equal to the natural duration is a redundant
    // override: clear any existing override rather than persisting a shadow of
    // the source duration; with no override it's simply a no-op. (Images can't
    // reach here — parsed is >= 1 but their natural durationSeconds is 0.)
    if (!isImage && parsed === item.durationSeconds) {
      if (item.durationOverride === null) {
        onClearError();
        setLocalError(false);
        return;
      }
      save(null);
      return;
    }
    save(parsed);
  };

  const warningBadge = warnZero ? (
    <span
      className="oa-dwell-warning"
      role="img"
      aria-label={t('playlistsPage.dwellWarning')}
      title={t('playlistsPage.dwellWarning')}
    >
      ⚠
    </span>
  ) : null;

  if (!canEdit) {
    return (
      <span className="oa-playlist-item__duration">
        {formatDuration(effective)}
        {warningBadge}
      </span>
    );
  }

  return (
    <span className="oa-playlist-item__duration">
      <input
        type="number"
        inputMode="numeric"
        min={MIN_DWELL}
        max={MAX_DWELL}
        step={1}
        className={localError ? 'oa-input--error' : undefined}
        value={draft}
        disabled={disabled || saving}
        aria-label={t('playlistsPage.dwellInputLabel', { name: item.contentFileName })}
        aria-invalid={localError}
        placeholder={isImage ? t('playlistsPage.dwellPlaceholder') : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          // Keep arrow/Home/End (number-input stepping + text nav) from
          // bubbling to the row's reorder handler.
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(server !== null ? String(server) : '');
            setLocalError(false);
            onClearError();
          }
        }}
        onBlur={commit}
      />
      <span className="oa-muted" aria-hidden="true">
        s
      </span>
      {warningBadge}
    </span>
  );
};

interface ContentPickerState {
  readonly open: boolean;
  readonly loading: boolean;
  readonly content: readonly ContentFileSummary[];
  readonly error: string | null;
}

const EMPTY_PICKER: ContentPickerState = {
  open: false,
  loading: false,
  content: [],
  error: null,
};

export const PlaylistsPage = () => {
  const { t } = useTranslation();
  const role = useRole();
  const canMutate = role === 'admin' || role === 'operator';
  const canDelete = role === 'admin';

  const { isOperator, projectIds, scopeResolved } = useAssignedProjects();
  const noProjects = isOperator && projectIds.length === 0;

  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [nameInput, setNameInput] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [page, setPage] = useState<number>(0);

  const [rows, setRows] = useState<readonly PlaylistSummary[]>([]);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [listError, setListError] = useState<string | null>(null);

  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [drawerData, setDrawerData] = useState<PlaylistDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState<boolean>(false);
  const [itemError, setItemError] = useState<string | null>(null);

  const [editName, setEditName] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [createState, setCreateState] = useState<{ projectId: string; name: string }>({
    projectId: '',
    name: '',
  });
  const [createSaving, setCreateSaving] = useState<boolean>(false);
  const [createNameError, setCreateNameError] = useState<string | undefined>(undefined);
  const [createGenericError, setCreateGenericError] = useState<string | null>(null);

  const [picker, setPicker] = useState<ContentPickerState>(EMPTY_PICKER);
  // Per-content dwell-time drafts (seconds) in the add-item picker, keyed by
  // content-file id. Only images require one; videos add without it.
  const [pickerDwell, setPickerDwell] = useState<Record<number, string>>({});

  const [dragId, setDragId] = useState<number | null>(null);
  const [draftOrder, setDraftOrder] = useState<readonly PlaylistItemDto[] | null>(null);
  // Guards against overlapping reorder writes — only one PUT /items/reorder
  // is allowed in flight per drawer view. Set before the request, cleared in
  // `finally`. While true, drag handles and move buttons are inert.
  const [isReordering, setIsReordering] = useState<boolean>(false);
  // Live-region announcement for screen-readers after a keyboard/button move.
  // Wiped after the drawer closes so a stale announcement isn't read out the
  // next time it opens.
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>('');
  // After a keyboard/button move, the moved row should keep focus across the
  // re-render so the operator can chain Arrow keys without re-tabbing. The
  // ref stores the item id we want focused; a layout effect reads it once and
  // clears it so subsequent renders don't steal focus from elsewhere.
  const refocusItemIdRef = useRef<number | null>(null);
  const itemListRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((p) => {
        if (!cancelled) setProjects(p);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (nameInput === name) return;
    const t = window.setTimeout(() => {
      setName(nameInput);
      setPage(0);
    }, NAME_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(t);
    };
  }, [nameInput, name]);

  const load = useCallback(() => {
    setIsLoading(true);
    setListError(null);
    const filters = {
      ...(projectId !== '' ? { projectId: Number.parseInt(projectId, 10) } : {}),
      ...(name !== '' ? { name } : {}),
    };
    listPlaylists(filters, { page, size: PAGE_SIZE, sort: 'name,asc' })
      .then((res) => {
        setRows(res.content);
        setTotalPages(res.totalPages);
      })
      .catch((err: unknown) => {
        setListError(extractMessage(err) ?? t('playlistsPage.errLoadList'));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [projectId, name, page, t]);

  useEffect(() => {
    if (!scopeResolved) return;
    if (noProjects) {
      setRows([]);
      setTotalPages(0);
      setIsLoading(false);
      return;
    }
    load();
  }, [load, scopeResolved, noProjects]);

  const visibleProjects = useMemo(
    () => (isOperator ? projects.filter((p) => projectIds.includes(p.id)) : projects),
    [isOperator, projects, projectIds],
  );

  useEffect(() => {
    const only = visibleProjects[0];
    if (isOperator && visibleProjects.length === 1 && only !== undefined && projectId === '') {
      setProjectId(String(only.id));
      setPage(0);
    }
  }, [isOperator, visibleProjects, projectId]);

  const projectOptions = useMemo(
    () => [
      ...(isOperator ? [] : [{ value: '', label: t('playlistsPage.allProjects') }]),
      ...visibleProjects.map((p) => ({ value: String(p.id), label: p.name })),
    ],
    [visibleProjects, isOperator, t],
  );

  const projectName = useCallback(
    (id: number | null): string => {
      // A null project (orphan playlist) or the -1 "Unassigned" sentinel has no
      // matching row in `projects`; show a readable label instead of `#-1`.
      if (id === null || id <= 0) return t('playlistsPage.unassigned');
      return projects.find((p) => p.id === id)?.name ?? `#${String(id)}`;
    },
    [projects, t],
  );

  const refreshDrawer = useCallback((id: number) => {
    return getPlaylist(id).then((d) => {
      setDrawerData(d);
      setDraftOrder(null);
      return d;
    });
  }, []);

  const openDrawer = (id: number): void => {
    setDrawerId(id);
    setDrawerData(null);
    setEditName(null);
    setEditError(null);
    setDeleteError(null);
    setItemError(null);
    setDrawerLoading(true);
    refreshDrawer(id)
      .catch((err: unknown) => {
        notify.error(extractMessage(err) ?? t('playlistsPage.errLoadPlaylist'));
        setDrawerId(null);
      })
      .finally(() => {
        setDrawerLoading(false);
      });
  };

  const closeDrawer = (): void => {
    setDrawerId(null);
    setDrawerData(null);
    setEditName(null);
    setEditError(null);
    setDeleteError(null);
    setItemError(null);
    setDraftOrder(null);
    setPicker(EMPTY_PICKER);
    setPickerDwell({});
    setLiveAnnouncement('');
  };

  const submitRename = (): void => {
    if (drawerData === null || editName === null) return;
    if (editName === drawerData.name) {
      setEditName(null);
      return;
    }
    setEditSaving(true);
    setEditError(null);
    renamePlaylist(drawerData.id, editName)
      .then((d) => {
        setDrawerData(d);
        setEditName(null);
        load();
      })
      .catch((err: unknown) => {
        setEditError(extractMessage(err) ?? t('playlistsPage.errSaveChanges'));
      })
      .finally(() => {
        setEditSaving(false);
      });
  };

  const submitDelete = async (): Promise<void> => {
    if (drawerData === null) return;
    setDeleteError(null);
    try {
      await deletePlaylist(drawerData.id);
      setConfirmDelete(false);
      closeDrawer();
      load();
    } catch (err: unknown) {
      const msg = extractMessage(err) ?? t('playlistsPage.errDeletePlaylist');
      setDeleteError(msg);
      setConfirmDelete(false);
      throw err;
    }
  };

  const submitCreate = (): void => {
    if (createSaving) return;
    setCreateNameError(undefined);
    setCreateGenericError(null);
    if (createState.projectId === '' || createState.name.trim() === '') {
      setCreateGenericError(t('playlistsPage.errProjectNameRequired'));
      return;
    }
    setCreateSaving(true);
    createPlaylist({
      projectId: Number.parseInt(createState.projectId, 10),
      name: createState.name.trim(),
    })
      .then(() => {
        setCreateOpen(false);
        setCreateState({ projectId: '', name: '' });
        load();
      })
      .catch((err: unknown) => {
        const msg = extractMessage(err) ?? t('playlistsPage.errCreatePlaylist');
        if (axios.isAxiosError(err) && err.response?.status === 409) {
          setCreateNameError(msg);
        } else {
          setCreateGenericError(msg);
        }
      })
      .finally(() => {
        setCreateSaving(false);
      });
  };

  const openContentPicker = (): void => {
    if (drawerData === null) return;
    setPickerDwell({});
    setPicker({ ...EMPTY_PICKER, open: true, loading: true });
    // A playlist bound to the seeded "Unassigned" project carries projectId = -1
    // (and a genuinely orphan playlist carries null). Neither is a real project
    // to scope by — forwarding it makes the backend filter content to a project
    // nothing is bound to and return an empty picker. Only include the filter
    // for a real, positive project id; otherwise omit it so the picker lists all
    // READY content (same conditional-spread idiom as `load` above).
    const pid = drawerData.projectId;
    listContent(
      { status: 'READY', ...(typeof pid === 'number' && pid > 0 ? { projectId: pid } : {}) },
      { page: 0, size: CONTENT_PAGE_SIZE, sort: 'name,asc' },
    )
      .then((res) => {
        setPicker({ open: true, loading: false, content: res.content, error: null });
      })
      .catch((err: unknown) => {
        setPicker({
          open: true,
          loading: false,
          content: [],
          error: extractMessage(err) ?? t('playlistsPage.errLoadContent'),
        });
      });
  };

  const addItem = (contentFileId: number, durationSeconds?: number): void => {
    if (drawerData === null) return;
    // Images require an operator-set dwell time; videos add with their natural
    // duration (durationSeconds omitted → override stays null server-side).
    addPlaylistItem(drawerData.id, {
      contentFileId,
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    })
      .then(async () => {
        setPicker(EMPTY_PICKER);
        setPickerDwell({});
        await refreshDrawer(drawerData.id);
        load();
      })
      .catch((err: unknown) => {
        setPicker((prev) => ({
          ...prev,
          error: extractMessage(err) ?? t('playlistsPage.errAddItem'),
        }));
      });
  };

  const removeItem = (itemId: number): void => {
    if (drawerData === null) return;
    setItemError(null);
    removePlaylistItem(drawerData.id, itemId)
      .then(async () => {
        await refreshDrawer(drawerData.id);
        load();
      })
      .catch((err: unknown) => {
        setItemError(extractMessage(err) ?? t('playlistsPage.errRemoveItem'));
      });
  };

  const items: readonly PlaylistItemDto[] = draftOrder ?? drawerData?.items ?? [];

  /**
   * Single commit path shared by drag / keyboard / button reorders. Compares
   * to the server order, short-circuits on no-op, then PUT /reorder. On
   * success: clears the optimistic copy (refreshDrawer will paint the
   * authoritative server order) and toasts success. On error: rolls back the
   * optimistic copy and surfaces the backend message verbatim inline. The
   * `isReordering` guard blocks concurrent writes.
   */
  const commitReorder = useCallback(
    (next: readonly PlaylistItemDto[]): void => {
      if (drawerData === null) return;
      if (isSameOrder(drawerData.items, next)) {
        setDraftOrder(null);
        return;
      }
      const orderedItemIds = next.map((it) => it.id);
      setItemError(null);
      setIsReordering(true);
      reorderPlaylistItems(drawerData.id, orderedItemIds)
        .then(async () => {
          await refreshDrawer(drawerData.id);
          // refreshDrawer already calls setDraftOrder(null); the explicit
          // call below is belt-and-suspenders for code paths that might
          // change refreshDrawer in future.
          setDraftOrder(null);
          notify.success(t('playlistsPage.orderSaved'));
        })
        .catch((err: unknown) => {
          setItemError(extractMessage(err) ?? t('playlistsPage.errReorder'));
          setDraftOrder(null);
        })
        .finally(() => {
          setIsReordering(false);
        });
    },
    [drawerData, refreshDrawer, t],
  );

  const onDragStart = (id: number) => (_e: DragEvent<HTMLLIElement>): void => {
    if (isReordering) return;
    setDragId(id);
  };

  const onDragOver = (id: number) => (e: DragEvent<HTMLLIElement>): void => {
    if (dragId === null || dragId === id) return;
    e.preventDefault();
    const current = draftOrder ?? drawerData?.items ?? [];
    const fromIndex = current.findIndex((it) => it.id === dragId);
    const toIndex = current.findIndex((it) => it.id === id);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    setDraftOrder(moveItemByIndex(current, fromIndex, toIndex));
  };

  const onDragEnd = (): void => {
    setDragId(null);
    if (drawerData === null || draftOrder === null) return;
    commitReorder(draftOrder);
  };

  /**
   * Keyboard + Move-up/down handler. `toIndex` is clamped by `moveItemByIndex`,
   * so out-of-range jumps (e.g. ArrowUp at index 0) become no-ops with no
   * announcement and no API call. Tracks which item should keep focus across
   * the re-render via `refocusItemIdRef`.
   */
  const moveItemTo = useCallback(
    (itemId: number, toIndex: number): void => {
      if (drawerData === null) return;
      if (isReordering) return;
      const current = draftOrder ?? drawerData.items;
      const fromIndex = current.findIndex((it) => it.id === itemId);
      if (fromIndex < 0) return;
      const next = moveItemByIndex(current, fromIndex, toIndex);
      if (next === current) return;
      const moved = current[fromIndex];
      const newIndex = next.findIndex((it) => it.id === itemId);
      setDraftOrder(next);
      refocusItemIdRef.current = itemId;
      if (moved !== undefined) {
        setLiveAnnouncement(
          t('playlistsPage.movedAnnouncement', {
            name: moved.contentFileName,
            position: newIndex + 1,
            total: next.length,
          }),
        );
      }
      commitReorder(next);
    },
    [drawerData, draftOrder, isReordering, commitReorder, t],
  );

  const onItemKeyDown = (it: PlaylistItemDto, index: number) =>
    (e: KeyboardEvent<HTMLLIElement>): void => {
      if (!canMutate || isReordering) return;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveItemTo(it.id, index - 1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveItemTo(it.id, index + 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        moveItemTo(it.id, 0);
      } else if (e.key === 'End') {
        e.preventDefault();
        moveItemTo(it.id, items.length - 1);
      }
    };

  // Restore focus on the moved row after the optimistic re-render so the
  // operator can keep chaining Arrow keys without re-tabbing into the list.
  useLayoutEffect(() => {
    const id = refocusItemIdRef.current;
    if (id === null) return;
    const ul = itemListRef.current;
    if (ul === null) return;
    const target = ul.querySelector<HTMLLIElement>(`[data-item-id="${String(id)}"]`);
    if (target !== null) target.focus();
    refocusItemIdRef.current = null;
  });

  const columns: readonly Column<PlaylistSummary>[] = useMemo(
    () => [
      { key: 'name', header: t('playlistsPage.colName'), render: (r) => r.name },
      { key: 'project', header: t('playlistsPage.colProject'), render: (r) => projectName(r.projectId) },
      { key: 'itemCount', header: t('playlistsPage.colItems'), width: '90px', render: (r) => r.itemCount },
      {
        key: 'duration',
        header: t('playlistsPage.colDuration'),
        width: '110px',
        render: (r) => formatDuration(r.totalDurationSeconds),
      },
    ],
    [projectName, t],
  );

  if (!scopeResolved) {
    return (
      <div className="oa-settings-page">
        <Spinner size="lg" label={t('operatorScope.loading')} />
      </div>
    );
  }

  if (noProjects) {
    return (
      <div className="oa-settings-page">
        <EmptyState
          title={t('operatorScope.noProjectsTitle')}
          description={t('operatorScope.noProjectsDesc')}
        />
      </div>
    );
  }

  return (
    <div className="oa-settings-page">
      <header className="oa-settings-page__header">
        <h2>{t('playlistsPage.title')}</h2>
        {canMutate && (
          <Button
            variant="primary"
            onClick={() => {
              setCreateState({ projectId: '', name: '' });
              setCreateNameError(undefined);
              setCreateGenericError(null);
              setCreateOpen(true);
            }}
          >
            {t('playlistsPage.newPlaylist')}
          </Button>
        )}
      </header>

      <div className="oa-settings-page__filters">
        <Select
          label={t('playlistsPage.project')}
          options={projectOptions}
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            setPage(0);
          }}
        />
        <SearchInput
          label={t('playlistsPage.name')}
          value={nameInput}
          onChange={(e) => {
            setNameInput(e.target.value);
          }}
          onClear={() => {
            setNameInput('');
            setName('');
            setPage(0);
          }}
          placeholder={t('playlistsPage.searchByName')}
          autoComplete="off"
        />
      </div>

      {listError !== null && <div className="oa-settings-page__error">{listError}</div>}

      <Table
        columns={columns}
        data={rows}
        rowKey={(r) => String(r.id)}
        isLoading={isLoading}
        emptyTitle={
          projectId !== '' || name !== ''
            ? t('playlistsPage.emptyTitleFiltered')
            : t('playlistsPage.emptyTitle')
        }
        emptyDescription={
          canMutate
            ? t('playlistsPage.emptyDescMutate')
            : t('playlistsPage.emptyDescReadonly')
        }
        onRowClick={(r) => {
          openDrawer(r.id);
        }}
      />

      <Pagination
        currentPage={page + 1}
        totalPages={totalPages}
        onPageChange={(p) => {
          setPage(p - 1);
        }}
      />

      <Drawer
        isOpen={drawerId !== null}
        onClose={closeDrawer}
        title={drawerData?.name ?? t('playlistsPage.playlist')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={closeDrawer}>
              {t('playlistsPage.close')}
            </Button>
            {canMutate && drawerData !== null && editName === null && (
              <Button
                variant="secondary"
                onClick={() => {
                  setEditName(drawerData.name);
                  setEditError(null);
                }}
              >
                {t('playlistsPage.rename')}
              </Button>
            )}
            {canDelete && drawerData !== null && editName === null && (
              <RoleGate roles={['admin']}>
                <Button
                  variant="danger"
                  onClick={() => {
                    setDeleteError(null);
                    setConfirmDelete(true);
                  }}
                >
                  {t('playlistsPage.delete')}
                </Button>
              </RoleGate>
            )}
            {editName !== null && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditName(null);
                    setEditError(null);
                  }}
                >
                  {t('playlistsPage.cancel')}
                </Button>
                <Button variant="primary" onClick={submitRename} isLoading={editSaving}>
                  {t('playlistsPage.save')}
                </Button>
              </>
            )}
          </>
        }
      >
        {drawerLoading && <p className="oa-muted">{t('playlistsPage.loading')}</p>}
        {drawerData !== null && editName === null && (
          <div className="oa-settings-detail">
            <div className="oa-settings-detail__row">
              <span className="oa-settings-detail__label">{t('playlistsPage.project')}</span>
              <span>{projectName(drawerData.projectId)}</span>
            </div>
            <div className="oa-settings-detail__row">
              <span className="oa-settings-detail__label">{t('playlistsPage.totalDuration')}</span>
              <span>{formatDuration(drawerData.totalDurationSeconds)}</span>
            </div>
            <div className="oa-settings-detail__row">
              <span className="oa-settings-detail__label">{t('playlistsPage.lastUpdated')}</span>
              <span title={drawerData.updatedAt}>{formatTimestamp(drawerData.updatedAt)}</span>
            </div>

            {deleteError !== null && (
              <div className="oa-settings-page__error" role="alert">
                {deleteError}
              </div>
            )}

            <div className="oa-settings-detail__section">
              <div className="oa-settings-detail__actions">
                <h3>{t('playlistsPage.itemsHeading', { count: items.length })}</h3>
                {canMutate && (
                  <Button variant="secondary" size="sm" onClick={openContentPicker}>
                    {t('playlistsPage.addItem')}
                  </Button>
                )}
              </div>
              {itemError !== null && <div className="oa-settings-page__error">{itemError}</div>}
              {items.length === 0 ? (
                <p className="oa-muted">{t('playlistsPage.noItems')}</p>
              ) : (
                <ul
                  ref={itemListRef}
                  className="oa-settings-detail__list"
                  style={{ gap: '0.375rem' }}
                  role="listbox"
                  aria-label={t('playlistsPage.listAriaLabel')}
                >
                  {items.map((it, index) => {
                    const isDragging = dragId === it.id;
                    const isFirst = index === 0;
                    const isLast = index === items.length - 1;
                    const moveDisabled = !canMutate || isReordering;
                    return (
                      <li
                        key={it.id}
                        data-item-id={it.id}
                        className={`oa-playlist-item${isDragging ? ' oa-playlist-item--dragging' : ''}`}
                        draggable={canMutate && !isReordering}
                        onDragStart={onDragStart(it.id)}
                        onDragOver={onDragOver(it.id)}
                        onDragEnd={onDragEnd}
                        onDrop={onDragEnd}
                        onKeyDown={onItemKeyDown(it, index)}
                        role="option"
                        aria-roledescription={t('playlistsPage.reorderableItem')}
                        aria-selected={false}
                        aria-posinset={index + 1}
                        aria-setsize={items.length}
                        aria-label={t('playlistsPage.itemPosition', {
                          name: it.contentFileName,
                          position: index + 1,
                          total: items.length,
                        })}
                        tabIndex={canMutate ? 0 : -1}
                      >
                        <span className="oa-playlist-item__handle" aria-hidden="true">
                          ⋮⋮
                        </span>
                        <span className="oa-playlist-item__name" title={it.contentFileName}>
                          {it.contentFileName}
                        </span>
                        {canMutate && (
                          <span className="oa-playlist-item__move" aria-hidden="true">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                moveItemTo(it.id, index - 1);
                              }}
                              disabled={moveDisabled || isFirst}
                              aria-label={t('playlistsPage.moveUp', { name: it.contentFileName })}
                              title={t('playlistsPage.moveUpTitle')}
                            >
                              ↑
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                moveItemTo(it.id, index + 1);
                              }}
                              disabled={moveDisabled || isLast}
                              aria-label={t('playlistsPage.moveDown', { name: it.contentFileName })}
                              title={t('playlistsPage.moveDownTitle')}
                            >
                              ↓
                            </Button>
                          </span>
                        )}
                        <DurationCell
                          item={it}
                          playlistId={drawerData.id}
                          canEdit={canMutate}
                          disabled={isReordering}
                          onCommitted={() => {
                            void refreshDrawer(drawerData.id).then(() => {
                              load();
                            });
                          }}
                          onError={(msg) => {
                            setItemError(msg);
                          }}
                          onClearError={() => {
                            setItemError(null);
                          }}
                        />
                        {canMutate && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              removeItem(it.id);
                            }}
                          >
                            {t('playlistsPage.remove')}
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="oa-sr-only" role="status" aria-live="polite" aria-atomic="true">
                {liveAnnouncement}
              </div>
            </div>
          </div>
        )}
        {drawerData !== null && editName !== null && (
          <div className="oa-settings-form">
            <FormInput
              label={t('playlistsPage.name')}
              value={editName}
              onChange={(e) => {
                setEditName(e.target.value);
              }}
            />
            {editError !== null && <div className="oa-settings-page__error">{editError}</div>}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        isOpen={confirmDelete}
        title={t('playlistsPage.deleteConfirmTitle')}
        message={
          drawerData !== null
            ? t('playlistsPage.deleteConfirmMessage', { name: drawerData.name })
            : ''
        }
        variant="danger"
        confirmLabel={t('playlistsPage.delete')}
        onCancel={() => {
          setConfirmDelete(false);
        }}
        onConfirm={submitDelete}
      />

      <Modal
        isOpen={createOpen}
        onClose={() => {
          setCreateOpen(false);
        }}
        title={t('playlistsPage.newPlaylistTitle')}
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setCreateOpen(false);
              }}
              disabled={createSaving}
            >
              {t('playlistsPage.cancel')}
            </Button>
            <Button variant="primary" onClick={submitCreate} isLoading={createSaving}>
              {t('playlistsPage.create')}
            </Button>
          </>
        }
      >
        <div className="oa-settings-form">
          <Select
            label={t('playlistsPage.project')}
            options={[
              { value: '', label: t('playlistsPage.selectProject'), disabled: true },
              ...visibleProjects.map((p) => ({ value: String(p.id), label: p.name })),
            ]}
            value={createState.projectId}
            onChange={(e) => {
              setCreateState({ ...createState, projectId: e.target.value });
            }}
          />
          <FormInput
            label={t('playlistsPage.name')}
            value={createState.name}
            onChange={(e) => {
              setCreateState({ ...createState, name: e.target.value });
            }}
            error={createNameError}
          />
          {createGenericError !== null && (
            <div className="oa-settings-page__error">{createGenericError}</div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={picker.open}
        onClose={() => {
          setPicker(EMPTY_PICKER);
        }}
        title={t('playlistsPage.addPlaylistItem')}
        size="md"
        footer={
          <Button
            variant="ghost"
            onClick={() => {
              setPicker(EMPTY_PICKER);
            }}
          >
            {t('playlistsPage.cancel')}
          </Button>
        }
      >
        <div className="oa-settings-form">
          <p className="oa-settings-page__notice">
            {drawerData !== null
              ? t('playlistsPage.pickerNoticeProject', {
                  count: CONTENT_PAGE_SIZE,
                  project: projectName(drawerData.projectId),
                })
              : t('playlistsPage.pickerNotice', { count: CONTENT_PAGE_SIZE })}
          </p>
          <p className="oa-muted">{t('playlistsPage.imageDwellHint')}</p>
          {picker.loading && <p className="oa-muted">{t('playlistsPage.loading')}</p>}
          {picker.error !== null && <div className="oa-settings-page__error">{picker.error}</div>}
          {!picker.loading && picker.content.length === 0 && picker.error === null && (
            <p className="oa-muted">{t('playlistsPage.noReadyContent')}</p>
          )}
          {picker.content.length > 0 && (
            <ul className="oa-settings-detail__list">
              {picker.content.map((c) => {
                const isImage = isImageContentType(c.contentType);
                const dwellRaw = pickerDwell[c.id] ?? '';
                const dwellNum = Number(dwellRaw.trim());
                const dwellValid =
                  dwellRaw.trim() !== '' &&
                  Number.isInteger(dwellNum) &&
                  dwellNum >= MIN_DWELL &&
                  dwellNum <= MAX_DWELL;
                return (
                  <li key={c.id}>
                    <span>{c.name}</span>
                    <span
                      style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}
                    >
                      {isImage && (
                        <input
                          type="number"
                          inputMode="numeric"
                          min={MIN_DWELL}
                          max={MAX_DWELL}
                          step={1}
                          className="oa-dwell-input"
                          value={dwellRaw}
                          placeholder={t('playlistsPage.dwellPlaceholder')}
                          aria-label={t('playlistsPage.dwellInputLabel', { name: c.name })}
                          onChange={(e) => {
                            const next = e.target.value;
                            setPickerDwell((prev) => ({ ...prev, [c.id]: next }));
                          }}
                        />
                      )}
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={isImage && !dwellValid}
                        onClick={() => {
                          addItem(c.id, isImage ? dwellNum : undefined);
                        }}
                      >
                        {t('playlistsPage.add')}
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Modal>
    </div>
  );
};
