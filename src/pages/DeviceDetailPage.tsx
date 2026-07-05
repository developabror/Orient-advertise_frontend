import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import axios from 'axios';
import {
  ActivePlaylistPanel,
  Button,
  ConfirmDialog,
  DeviceEventsModal,
  DiagnosticsModal,
  EmptyState,
  EventRow,
  Modal,
  Select,
  Spinner,
  StatusDot,
  TimeAgo,
  VolumeControl,
} from '@components';
import { http } from '@api/http';
import { notify } from '@api/notify';
import {
  clearDeviceVolume,
  deleteDevice,
  isErrorResponse,
  listFacilities,
  listRegions,
  setDeviceVolume,
  updateDeviceLocation,
  type FacilitySummary,
  type RegionRecord,
} from '@api';
import { markErrorHandled } from '@api/errorDialog';
import {
  useDevice,
  useDeviceEvents,
  useDiagnostics,
  useRole,
  type DeviceDetail,
} from '@hooks';
import type { DeviceStatus } from '@api/deviceStatus';

const STATUS_LABEL_KEY: Record<DeviceStatus, string> = {
  online: 'deviceDetailPage.statusOnline',
  offline: 'deviceDetailPage.statusOffline',
  'no-content': 'deviceDetailPage.statusNoContent',
  unregistered: 'deviceDetailPage.statusUnregistered',
  unknown: 'deviceDetailPage.statusUnknown',
};

// Backend DeviceActionType (uppercase enum). Spec also has VOLUME_SET,
// PLAYBACK_PAUSE, PLAYBACK_RESUME, GET_DIAGNOSTICS — those have dedicated UI
// (volume slider, playlist controls, diagnostics modal) so the buttons here
// only expose SYNC_CONTENT and REBOOT.
type ActionType = 'sync' | 'restart';

const ACTION_TO_API: Record<ActionType, 'SYNC_CONTENT' | 'REBOOT'> = {
  sync: 'SYNC_CONTENT',
  restart: 'REBOOT',
};

interface PendingAction {
  readonly type: ActionType;
}

const actionLabel = (t: TFunction, type: ActionType): string =>
  t(`deviceDetailPage.action_${type}`);

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

interface MoveModalProps {
  readonly deviceId: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onMoved: () => void;
}

const MoveDeviceModal = ({ deviceId, isOpen, onClose, onMoved }: MoveModalProps) => {
  const { t } = useTranslation();
  const [regions, setRegions] = useState<readonly RegionRecord[]>([]);
  const [facilities, setFacilities] = useState<readonly FacilitySummary[]>([]);
  const [regionId, setRegionId] = useState<string>('');
  const [facilityId, setFacilityId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [loadingFacilities, setLoadingFacilities] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;
    setRegionId('');
    setFacilityId('');
    setFacilities([]);
    setError(null);
    setSubmitting(false);
    listRegions({}, { page: 0, size: 100 })
      .then((p) => {
        setRegions(p.content);
      })
      .catch((err: unknown) => {
        setError(extractMessage(err) ?? t('deviceDetailPage.errLoadRegions'));
      });
  }, [isOpen, t]);

  useEffect(() => {
    if (regionId === '') {
      setFacilities([]);
      setFacilityId('');
      return;
    }
    setLoadingFacilities(true);
    listFacilities({ regionId: Number.parseInt(regionId, 10) }, { page: 0, size: 100 })
      .then((p) => {
        setFacilities(p.content);
      })
      .catch((err: unknown) => {
        setError(extractMessage(err) ?? t('deviceDetailPage.errLoadFacilities'));
      })
      .finally(() => {
        setLoadingFacilities(false);
      });
  }, [regionId, t]);

  const submit = (): void => {
    if (regionId === '' || facilityId === '' || submitting) return;
    setSubmitting(true);
    setError(null);
    // Surfaces the backend 400 (facility not in region) / 409 (cross-project
    // group conflict — intra-project region moves now succeed) envelope
    // message inline via extractMessage.
    updateDeviceLocation(Number.parseInt(deviceId, 10), {
      regionId: Number.parseInt(regionId, 10),
      facilityId: Number.parseInt(facilityId, 10),
    })
      .then(() => {
        notify.success(t('deviceDetailPage.toastMoved'));
        onMoved();
        onClose();
      })
      .catch((err: unknown) => {
        setError(extractMessage(err) ?? t('deviceDetailPage.errMove'));
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('deviceDetailPage.moveTitle')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {t('deviceDetailPage.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            isLoading={submitting}
            disabled={regionId === '' || facilityId === ''}
          >
            {t('deviceDetailPage.move')}
          </Button>
        </>
      }
    >
      <div className="oa-settings-form">
        <Select
          label={t('deviceDetailPage.region')}
          options={[
            { value: '', label: t('deviceDetailPage.selectRegion'), disabled: true },
            ...regions.map((r) => ({ value: String(r.id), label: r.name })),
          ]}
          value={regionId}
          onChange={(e) => {
            setRegionId(e.target.value);
            setFacilityId('');
          }}
        />
        <Select
          label={t('deviceDetailPage.facility')}
          options={[
            {
              value: '',
              label:
                regionId === ''
                  ? t('deviceDetailPage.selectRegionFirst')
                  : loadingFacilities
                    ? t('deviceDetailPage.loading')
                    : facilities.length === 0
                      ? t('deviceDetailPage.noFacilities')
                      : t('deviceDetailPage.selectFacility'),
              disabled: true,
            },
            ...facilities.map((f) => ({ value: String(f.id), label: f.name })),
          ]}
          value={facilityId}
          onChange={(e) => {
            setFacilityId(e.target.value);
          }}
          disabled={regionId === ''}
        />
        {error !== null && (
          <div className="oa-settings-page__error" role="alert">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
};

interface MetaCardProps {
  label: string;
  value: ReactNode;
  mono?: boolean;
}

const MetaCard = ({ label, value, mono = false }: MetaCardProps) => (
  <div className="oa-meta-card">
    <span className="oa-meta-card__label">{label}</span>
    <span className={`oa-meta-card__value${mono ? ' oa-mono' : ''}`}>{value}</span>
  </div>
);

const DeviceCards = ({ device }: { device: DeviceDetail }) => {
  const { t } = useTranslation();
  // Prefer a joined name; fall back to the id; then to an em-dash when the
  // device belongs to no sync group.
  const syncGroup =
    device.syncGroupName ??
    (device.syncGroupId !== null ? String(device.syncGroupId) : '—');
  return (
    <div className="oa-meta-grid">
      <MetaCard label={t('deviceDetailPage.facility')} value={device.facility} />
      <MetaCard label={t('deviceDetailPage.region')} value={device.region} />
      <MetaCard label={t('deviceDetailPage.group')} value={device.group} />
      <MetaCard label={t('deviceDetailPage.syncGroup')} value={syncGroup} />
      <MetaCard label={t('deviceDetailPage.serial')} value={device.serialNumber} mono />
      <MetaCard label={t('deviceDetailPage.ip')} value={device.ipAddress} mono />
      <MetaCard label={t('deviceDetailPage.version')} value={device.contentVersion} mono />
      <MetaCard
        label={t('deviceDetailPage.lastSeen')}
        value={
          device.lastSeen !== null ? (
            <TimeAgo date={device.lastSeen} />
          ) : (
            <span className="oa-muted">{t('deviceDetailPage.never')}</span>
          )
        }
      />
    </div>
  );
};

export const DeviceDetailPage = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const role = useRole();
  const fetchState = useDevice(id);
  const { events, isLoading: eventsLoading } = useDeviceEvents(id);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Admin and operator can drive devices; other roles see the panel read-only.
  const canControl = role === 'admin' || role === 'operator';
  // Deleting a device (soft-delete) is ADMIN-only; the API enforces this too.
  const canDelete = role === 'admin';

  // Diagnostics is a direct GET, not a queued action — it doesn't share the
  // pendingAction/ConfirmDialog flow used by sync/identify/restart.
  const diagnostics = useDiagnostics(id ?? '');

  const [historyOpen, setHistoryOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  // Browser back if there's history (preserves /devices?region=…&page=…),
  // otherwise fall through to the list root.
  const goBack = (): void => {
    if (location.key !== 'default') navigate(-1);
    else navigate('/devices');
  };

  if (fetchState.state === 'loading') {
    return (
      <section className="oa-device-detail oa-device-detail--center">
        <Spinner size="lg" label={t('deviceDetailPage.loadingDevice')} />
      </section>
    );
  }

  if (fetchState.state === 'not-found') {
    return (
      <section className="oa-device-detail oa-device-detail--center">
        <EmptyState
          icon={
            <span className="oa-device-detail__missing" aria-hidden="true">
              ?
            </span>
          }
          title={t('deviceDetailPage.notFoundTitle')}
          description={t('deviceDetailPage.notFoundDesc', { id: id ?? '' })}
          action={<Button onClick={goBack}>{t('deviceDetailPage.backToDevices')}</Button>}
        />
      </section>
    );
  }

  if (fetchState.state === 'error') {
    return (
      <section className="oa-device-detail oa-device-detail--center">
        <EmptyState
          title={t('deviceDetailPage.loadErrorTitle')}
          description={t('deviceDetailPage.loadErrorDesc')}
          action={<Button onClick={goBack}>{t('deviceDetailPage.backToDevices')}</Button>}
        />
      </section>
    );
  }

  const device = fetchState.device;

  // Source of the effective volume. We only have the device's own fields here
  // (the detail DTO doesn't carry the group's volume), so an inherited value is
  // distinguished from the system default by whether it equals 100.
  const volumeSourceLabel =
    device.volumeOverride !== null
      ? t('deviceDetailPage.volumeSourceOverride')
      : device.effectiveVolume === 100
        ? t('deviceDetailPage.volumeSourceDefault')
        : t('deviceDetailPage.volumeSourceInherited');

  // Set/clear the per-device override, then hard-refresh the detail (same idiom
  // as the move flow) so the new effective/reported/source values render.
  const applyVolume = async (v: number): Promise<void> => {
    try {
      await setDeviceVolume(Number.parseInt(device.id, 10), v);
      navigate(0);
    } catch (err: unknown) {
      notify.error(extractMessage(err) ?? t('deviceDetailPage.errSetVolume'));
    }
  };

  const resetVolume = async (): Promise<void> => {
    try {
      await clearDeviceVolume(Number.parseInt(device.id, 10));
      navigate(0);
    } catch (err: unknown) {
      notify.error(extractMessage(err) ?? t('deviceDetailPage.errSetVolume'));
    }
  };

  return (
    <section className="oa-device-detail">
      <header className="oa-device-detail__header">
        <button type="button" className="oa-device-detail__back" onClick={goBack}>
          ← {t('deviceDetailPage.backToDevices')}
        </button>
        <div className="oa-device-detail__title">
          <h1 className="oa-mono">{device.id}</h1>
          <StatusDot status={device.status} label={t(STATUS_LABEL_KEY[device.status])} />
        </div>
      </header>

      <DeviceCards device={device} />

      <article className="oa-card oa-volume-panel">
        <header className="oa-panel-header">
          <h2>{t('deviceDetailPage.volume')}</h2>
        </header>
        <div className="oa-volume-panel__body">
          <div className="oa-volume-panel__readout">
            <span className="oa-volume-panel__effective">{device.effectiveVolume}%</span>
            <span className="oa-muted">{t('deviceDetailPage.volumeEffective')}</span>
          </div>
          <p className="oa-muted">{volumeSourceLabel}</p>
          {device.reportedVolume !== null && (
            <p className="oa-muted">
              {t('deviceDetailPage.volumeReported', { volume: device.reportedVolume })}
            </p>
          )}
          {canControl && (
            <div className="oa-volume-panel__control">
              <span className="oa-field__label">{t('deviceDetailPage.setVolume')}</span>
              <VolumeControl
                value={device.volumeOverride ?? device.effectiveVolume}
                onApply={applyVolume}
              />
              {device.volumeOverride !== null && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void resetVolume();
                  }}
                >
                  {t('deviceDetailPage.resetToInherit')}
                </Button>
              )}
            </div>
          )}
        </div>
      </article>

      <div className="oa-device-detail__panels">
        <ActivePlaylistPanel
          deviceId={device.id}
          playlist={device.activePlaylist}
          controlsEnabled={canControl}
        />

        {canControl && (
          <article className="oa-card oa-actions-panel">
            <header className="oa-panel-header">
              <h2>{t('deviceDetailPage.remoteActions')}</h2>
            </header>
            <div className="oa-actions-panel__buttons">
              <Button
                variant="secondary"
                onClick={diagnostics.fetch}
                isLoading={diagnostics.state.kind === 'loading'}
              >
                {t('deviceDetailPage.getDiagnostics')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setPendingAction({ type: 'sync' });
                }}
              >
                {t('deviceDetailPage.syncContent')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setMoveOpen(true);
                }}
              >
                {t('deviceDetailPage.moveDevice')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setPendingAction({ type: 'restart' });
                }}
              >
                {t('deviceDetailPage.restart')}
              </Button>
              {canDelete && (
                <Button
                  variant="danger"
                  onClick={() => {
                    setDeleteError(null);
                    setConfirmDelete(true);
                  }}
                >
                  {t('deviceDetailPage.deleteDevice')}
                </Button>
              )}
            </div>
            <p className="oa-actions-panel__hint">
              {t('deviceDetailPage.commandsHint')}
            </p>
          </article>
        )}
      </div>

      <article className="oa-card oa-timeline">
        <header className="oa-panel-header oa-timeline__header">
          <h2>{t('deviceDetailPage.recentEvents')}</h2>
          {events.length > 0 && (
            <button
              type="button"
              className="oa-timeline__history-btn"
              onClick={() => {
                setHistoryOpen(true);
              }}
            >
              {t('deviceDetailPage.viewFullHistory')}
            </button>
          )}
        </header>
        {eventsLoading ? (
          <div className="oa-timeline__loading">
            <Spinner label={t('deviceDetailPage.loadingEvents')} />
          </div>
        ) : events.length === 0 ? (
          <p className="oa-muted">{t('deviceDetailPage.noEvents')}</p>
        ) : (
          <ol className="oa-event-list">
            {events.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </ol>
        )}
      </article>

      <MoveDeviceModal
        deviceId={device.id}
        isOpen={moveOpen}
        onClose={() => {
          setMoveOpen(false);
        }}
        onMoved={() => {
          // Force a refresh of the detail by navigating to the same URL — the
          // useDevice hook re-runs on `id` changes; same id means we replace
          // the entry to nudge the user-visible state. The simpler path is to
          // reload from the server: bounce through the list and back.
          navigate(0);
        }}
      />

      <DeviceEventsModal
        isOpen={historyOpen}
        deviceId={device.id}
        onClose={() => {
          setHistoryOpen(false);
        }}
      />

      <DiagnosticsModal
        state={diagnostics.state}
        deviceId={device.id}
        onClose={diagnostics.close}
        onRetry={diagnostics.fetch}
      />

      <ConfirmDialog
        isOpen={pendingAction !== null}
        title={
          pendingAction !== null
            ? t('deviceDetailPage.confirmActionTitle', {
                action: actionLabel(t, pendingAction.type),
              })
            : ''
        }
        message={
          pendingAction !== null
            ? t('deviceDetailPage.confirmActionMessage', {
                action: actionLabel(t, pendingAction.type),
                id: device.id,
              })
            : ''
        }
        variant={pendingAction?.type === 'restart' ? 'danger' : 'default'}
        confirmLabel={t('deviceDetailPage.send')}
        onCancel={() => {
          setPendingAction(null);
        }}
        onConfirm={async () => {
          if (pendingAction === null) return;
          // Spec DeviceActionRequest: { type: enum, volume?: 0..100 }.
          await http.post(`/api/devices/${encodeURIComponent(device.id)}/actions`, {
            type: ACTION_TO_API[pendingAction.type],
          });
          notify.success(t('deviceDetailPage.toastCommandSent'));
          setPendingAction(null);
        }}
      />

      <ConfirmDialog
        isOpen={confirmDelete}
        title={t('deviceDetailPage.deleteTitle')}
        message={
          <>
            <p>
              <Trans
                i18nKey="deviceDetailPage.deleteMessage"
                values={{ id: device.id }}
                components={{ mono: <span className="oa-mono" /> }}
              />
            </p>
            {deleteError !== null && (
              <p className="oa-confirm__error" role="alert">
                {deleteError}
              </p>
            )}
          </>
        }
        variant="danger"
        confirmLabel={t('deviceDetailPage.deleteDevice')}
        onCancel={() => {
          setConfirmDelete(false);
          setDeleteError(null);
        }}
        onConfirm={async () => {
          setDeleteError(null);
          try {
            await deleteDevice(Number.parseInt(device.id, 10));
            notify.success(t('deviceDetailPage.toastDeleted'));
            setConfirmDelete(false);
            navigate('/devices', { replace: true });
          } catch (err: unknown) {
            // The global interceptor already toasts 403 and 5xx/network; only
            // surface inline for failures it lets fall through (e.g. 404). Keep
            // the dialog open + re-enabled either way (rethrow).
            const status = axios.isAxiosError(err) ? err.response?.status : undefined;
            if (status !== undefined && status < 500 && status !== 403) {
              setDeleteError(extractMessage(err) ?? t('deviceDetailPage.errDelete'));
            }
            throw err;
          }
        }}
      />
    </section>
  );
};
