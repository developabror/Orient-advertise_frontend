import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Button,
  type Column,
  ConfirmDialog,
  EmptyState,
  Modal,
  Pagination,
  SearchInput,
  Select,
  Spinner,
  StatusDot,
  Table,
  type TableSelection,
  TimeAgo,
  VolumeControl,
} from '@components';
import { notify } from '@api/notify';
import { markErrorHandled } from '@api/errorDialog';
import {
  planBulkSelection,
  runBulkGroupActions,
  type BulkPlan,
  type BulkSummary,
  type DeviceGroupAction,
} from '@api/bulkDeviceActions';
import { useDevices, type Device, type DevicesQuery } from '@hooks/useDevices';
import { PLAYLIST_FILTER_OPTIONS, STATUS_FILTER_OPTIONS, STATUS_LABELS } from '@api/deviceStatus';
import { useRegions } from '@hooks/useRegions';
import { useRole } from '@hooks/useRole';
import { useAssignedProjects } from '@hooks/useAssignedProjects';
import {
  isErrorResponse,
  listDeviceGroups,
  listFacilities,
  setAllDevicesVolume,
  type DeviceGroupSummary,
  type FacilitySummary,
} from '@api';

const PAGE_SIZE = 20;
const FACILITY_DEBOUNCE_MS = 300;
const FACILITY_MIN_CHARS = 2;

// 'assign-content' still intentionally absent from this UI even though
// the underlying resource + runner now support it (runBulkGroupActions
// accepts an optional `payload: string` and DeviceGroupAction includes
// ASSIGN_CONTENT). Re-adding the option requires a playlist-picker
// dialog — that's tracked separately as the picker work; once it ships,
// add the entry here and pass `payload: JSON.stringify({ playlistId })`
// to runBulkGroupActions.
type BulkActionType = 'sync' | 'reboot';

// UI key → server enum on the device-group action endpoint.
const ACTION_PAYLOAD: Record<BulkActionType, DeviceGroupAction> = {
  sync: 'SYNC_CONTENT',
  reboot: 'REBOOT',
};

const isBulkAction = (v: string): v is BulkActionType => v === 'sync' || v === 'reboot';

type BulkState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'confirm'; readonly type: BulkActionType; readonly plan: BulkPlan }
  | {
      readonly kind: 'running';
      readonly type: BulkActionType;
      readonly totalGroups: number;
      readonly doneGroups: number;
      readonly skipped: number;
    }
  | {
      readonly kind: 'done';
      readonly type: BulkActionType;
      readonly summary: BulkSummary;
    };

const parsePage = (raw: string | null): number => {
  if (raw === null) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
};

// Normalize whatever the URL says into the value we'll actually search on:
// trim whitespace, drop anything below the minimum length.
const effectiveFacility = (raw: string): string => {
  const trimmed = raw.trim();
  return trimmed.length >= FACILITY_MIN_CHARS ? trimmed : '';
};

const bulkLabel = (t: (k: string) => string, type: BulkActionType): string =>
  t(`devicesPage.bulkLabel_${type}`);

const extractMessage = (err: unknown): string | null => {
  // Claim the error so the global error-dialog interceptor doesn't also surface
  // it; this page renders the backend message via a toast instead.
  markErrorHandled(err);
  if (!axios.isAxiosError(err)) return null;
  const data: unknown = err.response?.data;
  if (isErrorResponse(data)) return data.message;
  return null;
};

export const DevicesPage = () => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = parsePage(searchParams.get('page'));
  const region = searchParams.get('region') ?? '';
  const facility = effectiveFacility(searchParams.get('facility') ?? '');
  const status = searchParams.get('status') ?? '';
  const facilityId = searchParams.get('facilityId') ?? '';
  const deviceGroupId = searchParams.get('groupId') ?? '';
  const playlistState = searchParams.get('playlistState') ?? '';

  // Regions carry their projectId so we can derive the selected region's
  // project — device groups are now project-scoped (a group spans its
  // project's regions), while facilities stay region-bound.
  const regions = useRegions();
  const projectIdForRegion = useCallback(
    (regionIdStr: string): number | null => {
      if (regionIdStr === '') return null;
      const r = regions.find((x) => x.id === regionIdStr);
      return r ? r.projectId : null;
    },
    [regions],
  );

  const updateParam = useCallback(
    (key: string, value: string): void => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value === '') next.delete(key);
        else next.set(key, value);
        if (key !== 'page') next.delete('page');
        // Region drives the dependent pickers. Facilities are region-bound, so
        // always reset the facility on a region change. A device group spans
        // its project's regions, so only reset the group when the new region
        // belongs to a *different* project.
        if (key === 'region') {
          next.delete('facilityId');
          const oldProject = projectIdForRegion(prev.get('region') ?? '');
          const newProject = projectIdForRegion(value);
          if (oldProject !== newProject) next.delete('groupId');
        }
        return next;
      });
    },
    [setSearchParams, projectIdForRegion],
  );

  const clearFilters = useCallback((): void => {
    setSearchParams(new URLSearchParams());
  }, [setSearchParams]);

  // Local input state for responsive typing; the URL is updated only after
  // the debounce settles AND the trimmed value clears the 2-char minimum.
  const [facilityInput, setFacilityInput] = useState(facility);

  useEffect(() => {
    setFacilityInput(facility);
  }, [facility]);

  useEffect(() => {
    const next = effectiveFacility(facilityInput);
    if (next === facility) return;
    const timer = window.setTimeout(() => {
      updateParam('facility', next);
    }, FACILITY_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [facilityInput, facility, updateParam]);

  const handleClearFacility = useCallback((): void => {
    setFacilityInput('');
    // Bypass the debounce on explicit clear — the user expects instant reset.
    updateParam('facility', '');
  }, [updateParam]);

  const regionOptions = useMemo(
    () => [
      { value: '', label: t('devicesPage.allRegions') },
      ...regions.map((r) => ({ value: r.id, label: r.name })),
    ],
    [regions, t],
  );

  // The selected region's project (null when no region is picked, or before
  // regions have loaded). Drives the project-scoped device-group dropdown.
  const selectedProjectId = useMemo(
    () => projectIdForRegion(region),
    [projectIdForRegion, region],
  );

  // Picker sources. Facilities are region-bound, so the facility dropdown
  // loads after a region is picked. Device groups are project-scoped, so the
  // group dropdown loads off the selected region's *project* — that way it
  // surfaces every group in the project, not just one region's.
  const [facilityList, setFacilityList] = useState<readonly FacilitySummary[]>([]);
  const [groupList, setGroupList] = useState<readonly DeviceGroupSummary[]>([]);

  useEffect(() => {
    if (region === '') {
      setFacilityList([]);
      return;
    }
    const regionIdNum = Number.parseInt(region, 10);
    if (!Number.isFinite(regionIdNum)) return;
    let cancelled = false;
    listFacilities({ regionId: regionIdNum }, { page: 0, size: 100 })
      .then((p) => {
        if (!cancelled) setFacilityList(p.content);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [region]);

  useEffect(() => {
    if (selectedProjectId === null) {
      setGroupList([]);
      return;
    }
    let cancelled = false;
    listDeviceGroups({ projectId: selectedProjectId }, { page: 0, size: 100 })
      .then((p) => {
        if (!cancelled) setGroupList(p.content);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);

  const facilityOptions = useMemo(
    () => [
      {
        value: '',
        label: region === '' ? t('devicesPage.selectRegionFirst') : t('devicesPage.allFacilities'),
      },
      ...facilityList.map((f) => ({ value: String(f.id), label: f.name })),
    ],
    [facilityList, region, t],
  );

  const groupOptions = useMemo(
    () => [
      {
        value: '',
        label: region === '' ? t('devicesPage.selectRegionFirst') : t('devicesPage.allGroups'),
      },
      ...groupList.map((g) => ({ value: String(g.id), label: g.name })),
    ],
    [groupList, region, t],
  );

  const query: DevicesQuery = useMemo(
    () => ({
      page,
      size: PAGE_SIZE,
      region,
      facility,
      status,
      facilityId,
      deviceGroupId,
      playlistState,
    }),
    [page, region, facility, status, facilityId, deviceGroupId, playlistState],
  );

  const { devices, totalPages, isLoading, isStale } = useDevices(query);

  // Selection persists across pagination. We track groupId per device because
  // the bulk endpoint operates on groups — a Set<id> alone wouldn't tell us
  // which group a device on a previously-loaded page belonged to.
  const [selectedDevices, setSelectedDevices] = useState<ReadonlyMap<string, string | null>>(
    new Map<string, string | null>(),
  );
  const selectedIds = useMemo(() => new Set<string>(selectedDevices.keys()), [selectedDevices]);

  const [bulk, setBulk] = useState<BulkState>({ kind: 'idle' });

  const [volumeModalOpen, setVolumeModalOpen] = useState(false);
  const [volumeBusy, setVolumeBusy] = useState(false);

  const role = useRole();
  const canBulk = role === 'admin' || role === 'operator';

  // "Apply to all" — write the per-device override on every device in the
  // caller's scope. Volume isn't a list column (§6), so we surface the
  // affected-count toast rather than refetching the list.
  const applyAllVolume = async (v: number): Promise<void> => {
    setVolumeBusy(true);
    try {
      const { affected } = await setAllDevicesVolume(v);
      notify.success(t('devicesPage.volumeAppliedToN', { count: affected }));
      setVolumeModalOpen(false);
    } catch (err: unknown) {
      notify.error(extractMessage(err) ?? t('devicesPage.errSetVolumeAll'));
    } finally {
      setVolumeBusy(false);
    }
  };

  const { isOperator, projectIds, scopeResolved } = useAssignedProjects();
  const noProjects = isOperator && projectIds.length === 0;

  const onToggleRow = useCallback(
    (id: string) => {
      setSelectedDevices((prev) => {
        const next = new Map(prev);
        if (next.has(id)) {
          next.delete(id);
          return next;
        }
        // Fresh selection — capture the device's group affiliation so we can
        // route the bulk request correctly even after pagination.
        const device = devices.find((d) => d.id === id);
        next.set(id, device?.groupId ?? null);
        return next;
      });
    },
    [devices],
  );

  const onToggleVisible = useCallback(
    (visibleIds: readonly string[]) => {
      setSelectedDevices((prev) => {
        const next = new Map(prev);
        const everyVisibleSelected = visibleIds.every((id) => next.has(id));
        for (const id of visibleIds) {
          if (everyVisibleSelected) {
            next.delete(id);
          } else {
            const device = devices.find((d) => d.id === id);
            next.set(id, device?.groupId ?? null);
          }
        }
        return next;
      });
    },
    [devices],
  );

  const deselectAll = useCallback(() => {
    setSelectedDevices(new Map<string, string | null>());
  }, []);

  const onBulkPick = (e: ChangeEvent<HTMLSelectElement>): void => {
    const v = e.target.value;
    if (!isBulkAction(v)) return;
    const plan = planBulkSelection(selectedDevices);
    setBulk({ kind: 'confirm', type: v, plan });
  };

  const runBulk = async (type: BulkActionType, plan: BulkPlan): Promise<void> => {
    const groupCount = plan.byGroup.size;
    if (groupCount === 0) {
      // Nothing groupable — just warn and bail. The skipped warning is
      // surfaced separately so the admin understands why no requests fired.
      if (plan.ungrouped.length > 0) {
        notify.warning(
          t('devicesPage.skippedWarning', { count: plan.ungrouped.length }),
        );
      }
      setBulk({ kind: 'idle' });
      setSelectedDevices(new Map<string, string | null>());
      return;
    }

    setBulk({
      kind: 'running',
      type,
      totalGroups: groupCount,
      doneGroups: 0,
      skipped: plan.ungrouped.length,
    });

    const result = await runBulkGroupActions({
      action: ACTION_PAYLOAD[type],
      plan,
      onProgress: (doneGroups, totalGroups) => {
        setBulk((prev) => (prev.kind === 'running' ? { ...prev, doneGroups, totalGroups } : prev));
      },
    });

    setBulk({ kind: 'done', type, summary: result.summary });
    setSelectedDevices(new Map<string, string | null>());
  };

  const tableSelection: TableSelection | undefined = canBulk
    ? { selectedIds, onToggleRow, onToggleVisible }
    : undefined;

  const hasFilters =
    region !== '' ||
    facility !== '' ||
    status !== '' ||
    facilityId !== '' ||
    deviceGroupId !== '' ||
    playlistState !== '';
  const isSearchingFacility = isLoading && facilityInput.trim().length >= FACILITY_MIN_CHARS;

  const emptyTitle = useMemo(() => {
    if (facility !== '') return t('devicesPage.emptyNoMatchesFor', { facility });
    if (hasFilters) return t('devicesPage.emptyNoMatching');
    return t('devicesPage.emptyNoDevices');
  }, [facility, hasFilters, t]);

  const emptyDescription = hasFilters
    ? t('devicesPage.emptyDescFilters')
    : t('devicesPage.emptyDescDefault');

  const columns: readonly Column<Device>[] = useMemo(
    () => [
      {
        key: 'name',
        header: t('devicesPage.colDeviceName'),
        width: '180px',
        render: (d) => <Link to={`/devices/${d.id}`}>{d.name}</Link>,
      },
      { key: 'facility', header: t('devicesPage.colFacility'), render: (d) => d.facility },
      { key: 'region', header: t('devicesPage.colRegion'), render: (d) => d.region },
      {
        key: 'group',
        header: t('devicesPage.colGroup'),
        width: '160px',
        render: (d) => {
          if (d.groupName !== null) return d.groupName;
          return (
            <span className="oa-muted" title={t('devicesPage.notInGroup')}>
              —
            </span>
          );
        },
      },
      {
        key: 'activePlaylist',
        header: t('devicesPage.colActivePlaylist'),
        width: '180px',
        render: (d) =>
          d.hasActivePlaylist && d.activePlaylistName !== null ? (
            <span className="oa-badge-pill" title={t('devicesPage.activePlaylist')}>
              {d.activePlaylistName}
            </span>
          ) : (
            <span className="oa-muted" title={t('devicesPage.noActivePlaylist')}>
              —
            </span>
          ),
      },
      {
        key: 'status',
        header: t('devicesPage.colStatus'),
        width: '140px',
        render: (d) => <StatusDot status={d.status} label={STATUS_LABELS[d.status]} />,
      },
      {
        key: 'contentVersion',
        header: t('devicesPage.colContentVersion'),
        width: '160px',
        render: (d) => <code className="oa-mono">{d.contentVersion}</code>,
      },
      {
        key: 'lastSeen',
        header: t('devicesPage.colLastSeen'),
        width: '140px',
        render: (d) =>
          d.lastSeen !== null ? (
            <TimeAgo date={d.lastSeen} />
          ) : (
            <span className="oa-muted">{t('devicesPage.never')}</span>
          ),
      },
      {
        key: 'actions',
        header: t('devicesPage.colActions'),
        width: '100px',
        align: 'right',
        render: (d) => (
          <Link to={`/devices/${d.id}`} className="oa-btn oa-btn--ghost oa-btn--sm">
            {t('devicesPage.view')}
          </Link>
        ),
      },
    ],
    [t],
  );

  // Confirm-state derived values — only valid when bulk.kind === 'confirm'.
  const confirmInfo = useMemo(() => {
    if (bulk.kind !== 'confirm') return null;
    return {
      type: bulk.type,
      plan: bulk.plan,
      groupCount: bulk.plan.byGroup.size,
      groupedDeviceCount: Array.from(bulk.plan.byGroup.values()).reduce(
        (s, ids) => s + ids.length,
        0,
      ),
      ungroupedCount: bulk.plan.ungrouped.length,
    };
  }, [bulk]);

  if (!scopeResolved) {
    return (
      <section className="oa-devices">
        <Spinner size="lg" label={t('operatorScope.loading')} />
      </section>
    );
  }

  if (noProjects) {
    return (
      <section className="oa-devices">
        <EmptyState
          title={t('operatorScope.noProjectsTitle')}
          description={t('operatorScope.noProjectsDesc')}
        />
      </section>
    );
  }

  return (
    <section className="oa-devices">
      <header className="oa-devices__header">
        <h1>{t('devicesPage.title')}</h1>
        {isStale && (
          <span className="oa-dashboard__stale">{t('devicesPage.stale')}</span>
        )}
        {canBulk && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setVolumeModalOpen(true);
            }}
          >
            {t('devicesPage.setVolumeForAll')}
          </Button>
        )}
      </header>

      <div className="oa-filters">
        <Select
          label={t('devicesPage.filterRegion')}
          options={regionOptions}
          value={region}
          onChange={(e) => {
            updateParam('region', e.target.value);
          }}
        />
        <Select
          label={t('devicesPage.filterFacility')}
          options={facilityOptions}
          value={facilityId}
          onChange={(e) => {
            updateParam('facilityId', e.target.value);
          }}
          disabled={region === ''}
        />
        <Select
          label={t('devicesPage.filterDeviceGroup')}
          options={groupOptions}
          value={deviceGroupId}
          onChange={(e) => {
            updateParam('groupId', e.target.value);
          }}
          disabled={region === ''}
        />
        <SearchInput
          label={t('devicesPage.filterFacilityName')}
          value={facilityInput}
          onChange={(e) => {
            setFacilityInput(e.target.value);
          }}
          onClear={handleClearFacility}
          isSearching={isSearchingFacility}
          hint={t('devicesPage.facilityHint', { count: FACILITY_MIN_CHARS })}
          placeholder={t('devicesPage.facilityPlaceholder')}
          autoComplete="off"
        />
        <Select
          label={t('devicesPage.filterStatus')}
          options={STATUS_FILTER_OPTIONS}
          value={status}
          onChange={(e) => {
            updateParam('status', e.target.value);
          }}
        />
        <Select
          label={t('devicesPage.filterPlaylist')}
          options={PLAYLIST_FILTER_OPTIONS}
          value={playlistState}
          onChange={(e) => {
            updateParam('playlistState', e.target.value);
          }}
        />
        {hasFilters && (
          <div className="oa-filters__clear">
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              {t('devicesPage.clearFilters')}
            </Button>
          </div>
        )}
      </div>

      {canBulk && (selectedIds.size > 0 || bulk.kind === 'running') && (
        <div className="oa-bulk-bar" role="region" aria-label={t('devicesPage.bulkActions')}>
          {bulk.kind === 'running' ? (
            <div className="oa-bulk-bar__progress" role="status" aria-live="polite">
              <span className="oa-bulk-bar__progress-text">
                {t('devicesPage.dispatching', {
                  done: bulk.doneGroups,
                  total: bulk.totalGroups,
                  count: bulk.totalGroups,
                  action: bulkLabel(t, bulk.type).toLowerCase(),
                })}
              </span>
              <div className="oa-bulk-bar__progress-bar" aria-hidden="true">
                <span
                  className="oa-bulk-bar__progress-fill"
                  style={{
                    width: `${String((bulk.doneGroups / Math.max(1, bulk.totalGroups)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ) : (
            <>
              <span className="oa-bulk-bar__count">
                {t('devicesPage.selectedCount', { count: selectedIds.size })}
              </span>
              <Button variant="ghost" size="sm" onClick={deselectAll}>
                {t('devicesPage.deselectAll')}
              </Button>
              <div className="oa-bulk-bar__actions">
                <label className="oa-bulk-bar__label" htmlFor="oa-bulk-action">
                  {t('devicesPage.bulkAction')}
                </label>
                <select
                  id="oa-bulk-action"
                  className="oa-bulk-bar__select"
                  value=""
                  onChange={onBulkPick}
                >
                  <option value="">{t('devicesPage.chooseAction')}</option>
                  {/* 'assign-content' option intentionally omitted — see
                      BulkActionType comment above. */}
                  <option value="sync">{t('devicesPage.bulkLabel_sync')}</option>
                  <option value="reboot">{t('devicesPage.bulkLabel_reboot')}</option>
                </select>
              </div>
            </>
          )}
        </div>
      )}

      <div className="oa-devices__table">
        <Table
          columns={columns}
          data={devices}
          rowKey={(d) => d.id}
          isLoading={isLoading}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
          selection={tableSelection}
        />
      </div>

      <div className="oa-devices__pagination">
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={(p) => {
            updateParam('page', String(p));
          }}
        />
      </div>

      <ConfirmDialog
        isOpen={bulk.kind === 'confirm'}
        title={
          confirmInfo === null
            ? ''
            : t('devicesPage.confirmTitle', {
                action: bulkLabel(t, confirmInfo.type),
                count: confirmInfo.groupCount,
              })
        }
        message={
          confirmInfo === null ? (
            ''
          ) : (
            <div className="oa-bulk-confirm">
              <p>
                <Trans
                  i18nKey="devicesPage.confirmBody"
                  values={{
                    deviceCount: confirmInfo.groupedDeviceCount,
                    groupCount: confirmInfo.groupCount,
                  }}
                  components={{ s: <strong /> }}
                />
              </p>
              {confirmInfo.type === 'reboot' && (
                <p className="oa-bulk-confirm__danger">{t('devicesPage.confirmRebootDanger')}</p>
              )}
              {confirmInfo.ungroupedCount > 0 && (
                <p className="oa-bulk-confirm__warning" role="alert">
                  <Trans
                    i18nKey="devicesPage.confirmUngrouped"
                    values={{ count: confirmInfo.ungroupedCount }}
                    components={{ s: <strong /> }}
                  />
                </p>
              )}
            </div>
          )
        }
        variant={confirmInfo?.type === 'reboot' ? 'danger' : 'default'}
        confirmLabel={
          confirmInfo === null
            ? t('devicesPage.confirm')
            : t('devicesPage.confirmLabel', {
                action: bulkLabel(t, confirmInfo.type),
                count: confirmInfo.groupCount,
              })
        }
        onCancel={() => {
          setBulk({ kind: 'idle' });
        }}
        onConfirm={async () => {
          if (bulk.kind !== 'confirm') return;
          await runBulk(bulk.type, bulk.plan);
        }}
      />

      <Modal
        isOpen={bulk.kind === 'done'}
        onClose={() => {
          setBulk({ kind: 'idle' });
        }}
        title={
          bulk.kind === 'done'
            ? t('devicesPage.resultsTitle', { action: bulkLabel(t, bulk.type) })
            : t('devicesPage.resultsTitleDefault')
        }
        size="sm"
        footer={
          <Button
            variant="primary"
            onClick={() => {
              setBulk({ kind: 'idle' });
            }}
          >
            {t('devicesPage.done')}
          </Button>
        }
      >
        {bulk.kind === 'done' && (
          <div className="oa-bulk-summary">
            <div className="oa-bulk-summary__totals">
              <div className="oa-bulk-summary__cell">
                <span className="oa-bulk-summary__num">{bulk.summary.total.toLocaleString()}</span>
                <span className="oa-bulk-summary__label">{t('devicesPage.summaryTotal')}</span>
              </div>
              <div className="oa-bulk-summary__cell" data-status="ok">
                <span className="oa-bulk-summary__num">{bulk.summary.queued.toLocaleString()}</span>
                <span className="oa-bulk-summary__label">{t('devicesPage.summaryQueued')}</span>
              </div>
              <div
                className="oa-bulk-summary__cell"
                data-status={bulk.summary.failed > 0 ? 'fail' : 'ok'}
              >
                <span className="oa-bulk-summary__num">{bulk.summary.failed.toLocaleString()}</span>
                <span className="oa-bulk-summary__label">{t('devicesPage.summaryFailed')}</span>
              </div>
            </div>
            <p className="oa-bulk-summary__meta">
              <Trans
                i18nKey="devicesPage.summaryMeta"
                values={{
                  succeeded: bulk.summary.groupsSucceeded,
                  total: bulk.summary.groupCount,
                  count: bulk.summary.groupCount,
                }}
                components={{ s: <strong /> }}
              />
              {bulk.summary.groupsFailed > 0
                ? t('devicesPage.summaryFailedSuffix', { count: bulk.summary.groupsFailed })
                : ''}
              .
            </p>
            {bulk.summary.skipped > 0 && (
              <p className="oa-bulk-summary__warning" role="note">
                <Trans
                  i18nKey="devicesPage.summarySkipped"
                  values={{ count: bulk.summary.skipped }}
                  components={{ s: <strong /> }}
                />
              </p>
            )}
            {bulk.summary.errors !== undefined && bulk.summary.errors.length > 0 && (
              <div className="oa-bulk-summary__errors">
                {bulk.summary.errors.map((m, i) => (
                  <p key={`${String(i)}-${m}`} role="alert" className="oa-bulk-summary__error">
                    {m}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={volumeModalOpen}
        onClose={() => {
          setVolumeModalOpen(false);
        }}
        title={t('devicesPage.setVolumeForAll')}
        size="sm"
      >
        <div className="oa-settings-form">
          <p className="oa-muted">{t('devicesPage.setVolumeForAllHint')}</p>
          <VolumeControl value={100} onApply={applyAllVolume} busy={volumeBusy} />
        </div>
      </Modal>
    </section>
  );
};
