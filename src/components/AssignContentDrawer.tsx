import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import axios from 'axios';
import { Badge, type BadgeVariant } from './ui/Badge';
import { Button } from './ui/Button';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { Drawer } from './ui/Drawer';
import { SearchableSelect, type SearchableSelectOption } from './ui/SearchableSelect';
import { Table, type Column, type TableSelection } from './ui/Table';
import { http } from '@api/http';
import { notify } from '@api/notify';
import { extractApiMessage } from '@api';
import { markErrorHandled } from '@api/errorDialog';
import { mapStatus, STATUS_LABELS, type DeviceStatus } from '@api/deviceStatus';
import {
  parseOverlapDetails,
  type AssignmentConflict,
} from '@api/resources/assignments';
import { formatTashkent } from '@/lib/timezone';
import { useAssignmentTargets, type TargetType } from '@hooks/useAssignmentTargets';
import {
  useAssignmentPreview,
  type AssignmentPreviewQuery,
  type PreviewDevice,
} from '@hooks/useAssignmentPreview';
import { usePlaylistOptions } from '@hooks/usePlaylistOptions';
import {
  EMPTY_SELECTION,
  computeSelectedCount,
  deriveConfirmDeviceScope,
  isDeviceSelected,
  type ConfirmDeviceScope,
  type DeviceSelection,
} from './assignContentDrawer.helpers';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const TARGET_TYPES: readonly { value: TargetType; labelKey: string }[] = [
  { value: 'region', labelKey: 'targetTypeRegion' },
  { value: 'facility', labelKey: 'targetTypeFacility' },
  { value: 'group', labelKey: 'targetTypeGroup' },
];

// 1=Playlist, 2=Target, 3=Devices, 4=Schedule. Each step's body and
// transitions are keyed off this single state, so re-ordering means
// renumbering every comparison in this file.
type Step = 1 | 2 | 3 | 4;

const STEP_LABELS: readonly { step: Step; labelKey: string }[] = [
  { step: 1, labelKey: 'stepPlaylist' },
  { step: 2, labelKey: 'stepTarget' },
  { step: 3, labelKey: 'stepDevices' },
  { step: 4, labelKey: 'stepSchedule' },
];

// A blank end time means "run indefinitely". The backend resolver keeps an
// assignment live only while `endTime > now` — a lapsed window tells devices to
// drop the held files, so a device offline past the window reconnects to
// nothing. "Indefinite" is therefore expressed as a far-future sentinel (the
// year-2100 value agreed with AssignmentController), NOT an omitted/short end.
// An indefinite assignment can only be displaced by cancelling/replacing it.
const INDEFINITE_END_TIME_ISO = new Date('2100-01-01T00:00:00Z').toISOString();
const INDEFINITE_END_TIME_MS = new Date(INDEFINITE_END_TIME_ISO).getTime();

// `<input type="datetime-local">` reads/writes a local-naive "YYYY-MM-DDTHH:mm"
// string, and the submit path serializes it with `new Date(value).toISOString()`
// — i.e. interpreted in the *browser's* local zone. For the product's users
// (all in Tashkent) that local zone IS Tashkent, so the `min` we compute here
// must use the same local clock as the input, NOT a forced Tashkent offset, or
// it would disagree with what the picker shows. (Display of already-stored UTC
// instants — e.g. conflict windows — still goes through `formatTashkent`.)
const toLocalInputValue = (d: Date): string => {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
};

// Fallback for a 409 we can't break down into named conflicts (older backend,
// or any other overlap shape). Still avoids the raw developer string.
const genericOverlapMessage = (t: TFunction, noun: string): string =>
  t('assignContentDrawer.genericOverlap', { noun });

// One conflict's window, localized to Tashkent. The year-2100 sentinel renders
// as "No end date" rather than a misleading literal date.
const formatConflictWindow = (t: TFunction, c: AssignmentConflict): string => {
  const start = formatTashkent(c.startTime);
  const endMs = new Date(c.endTime).getTime();
  const end =
    Number.isFinite(endMs) && endMs >= INDEFINITE_END_TIME_MS
      ? t('assignContentDrawer.noEndDate')
      : formatTashkent(c.endTime);
  return `${start} → ${end}`;
};

const conflictPlaylistLabel = (t: TFunction, c: AssignmentConflict): string =>
  c.playlistName !== undefined && c.playlistName !== ''
    ? c.playlistName
    : t('assignContentDrawer.existingAssignment');

const formatPlaylistMeta = (
  t: TFunction,
  itemCount: number,
  totalDurationSeconds: number,
): string => {
  const items = t(
    itemCount === 1 ? 'assignContentDrawer.itemsOne' : 'assignContentDrawer.itemsOther',
    { count: itemCount },
  );
  if (!Number.isFinite(totalDurationSeconds) || totalDurationSeconds <= 0) return items;
  const totalMinutes = Math.round(totalDurationSeconds / 60);
  if (totalMinutes < 1) return t('assignContentDrawer.metaDurationUnderMin', { items });
  return t('assignContentDrawer.metaDuration', { items, minutes: totalMinutes });
};

// The assignment-preview API emits the real Device.Status enum names
// (device.getStatus().name()), so route them through the shared FE mapper —
// this surface then matches the device list/detail exactly (NO_CONTENT and
// UNREGISTERED render distinctly, not as a phantom catch-all). The preview's
// `offline` flag is authoritative and wins over the raw status string.
const BADGE_VARIANT: Record<DeviceStatus, BadgeVariant> = {
  online: 'success',
  offline: 'warning',
  'no-content': 'info',
  unregistered: 'info',
  unknown: 'info',
};

const previewStatus = (status: string, offline: boolean): DeviceStatus =>
  offline ? 'offline' : mapStatus(status);

const statusBadgeVariant = (status: string, offline: boolean): BadgeVariant =>
  BADGE_VARIANT[previewStatus(status, offline)];

const statusLabel = (status: string, offline: boolean): string =>
  STATUS_LABELS[previewStatus(status, offline)];

export const AssignContentDrawer = ({ isOpen, onClose }: Props) => {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>(1);
  const [playlistId, setPlaylistId] = useState<number | null>(null);
  const [targetType, setTargetType] = useState<TargetType>('region');
  const [targetId, setTargetId] = useState('');

  // Only fetch playlists once the drawer is open — avoids burning a request
  // on every page mount.
  const {
    playlists,
    isLoading: playlistsLoading,
    error: playlistsError,
    retry: retryPlaylists,
  } = usePlaylistOptions(isOpen);

  const { targets, isLoading, error, retry } = useAssignmentTargets(targetType);

  const [selection, setSelection] = useState<DeviceSelection>(EMPTY_SELECTION);

  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  // The now→indefinite window must be a deliberate, visible choice — not a
  // silent fallback for blank fields (which previously overlapped any active
  // booking and produced a surprise 409). Both default OFF so the operator
  // either picks explicit times or knowingly opts into "start now" / "no end".
  const [startNow, setStartNow] = useState(false);
  const [noEndDate, setNoEndDate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Inline error from confirm — the generic friendly overlap string used when
  // the 409 carries no structured, named conflicts (older backend). A 409 that
  // DOES name conflicts populates `overlap` (below) instead, which renders the
  // actionable Replace panel.
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // Structured overlap: the named conflict(s) blocking this window, plus the
  // target noun for copy. Non-null → the Replace panel is shown in step 4.
  const [overlap, setOverlap] = useState<{
    readonly noun: string;
    readonly conflicts: readonly AssignmentConflict[];
  } | null>(null);
  // Destructive-confirm gate for the Replace action, and an inline error if the
  // replace itself fails (shown back in the overlap panel so the operator can
  // retry or choose another time).
  const [replaceConfirmOpen, setReplaceConfirmOpen] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);

  // Frozen device-selection context, captured when the operator advances from
  // the Devices step (3 → 4). Step 4 must NOT read the live preview hook: once
  // `previewQuery` goes null on step 4 the hook resets to devices=[] /
  // totalDevices=0, which would (a) zero out the all-across count → Confirm
  // disabled, and (b) make `deriveConfirmDeviceScope` see no devices → a silent
  // full-scope fan-out. The snapshot holds exactly what Confirm needs: the count
  // to display and the device scope (included/excluded) to POST.
  const [confirmSnapshot, setConfirmSnapshot] = useState<{
    readonly selectedCount: number;
    readonly deviceScope: ConfirmDeviceScope;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setPlaylistId(null);
      setTargetType('region');
      setTargetId('');
      setSelection(EMPTY_SELECTION);
      setStartAt('');
      setEndAt('');
      setStartNow(false);
      setNoEndDate(false);
      setSubmitting(false);
      setDiscardOpen(false);
      setConfirmSnapshot(null);
      // Clear any inline confirm error (e.g. a 409 overlap message) so it can't
      // leak into the next, unrelated assignment session.
      setConfirmError(null);
      setOverlap(null);
      setReplaceConfirmOpen(false);
      setReplaceError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    setTargetId('');
  }, [targetType]);

  useEffect(() => {
    // Re-editing the target invalidates any frozen device selection.
    setSelection(EMPTY_SELECTION);
    setConfirmSnapshot(null);
  }, [targetId]);

  const previewQuery: AssignmentPreviewQuery | null =
    step === 3 && targetId !== '' ? { targetType, targetId } : null;

  const {
    devices: previewDevices,
    totalDevices,
    truncated,
    isLoading: previewLoading,
    error: previewError,
    retry: previewRetry,
  } = useAssignmentPreview(previewQuery);

  const selectedCount = computeSelectedCount(selection, totalDevices);

  // On the Schedule step the live preview is gone (previewQuery is null), so
  // the count comes from the snapshot frozen at step 3 → 4. On every earlier
  // step the live value is authoritative.
  const effectiveSelectedCount =
    step === 4 && confirmSnapshot !== null ? confirmSnapshot.selectedCount : selectedCount;

  const onToggleRow = useCallback((id: string) => {
    setSelection((sel) => {
      const next = new Set(sel.ids);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { mode: sel.mode, ids: next };
    });
  }, []);

  const onTogglePage = useCallback((visibleIds: readonly string[]) => {
    setSelection((sel) => {
      const allVisibleSelected = visibleIds.every((id) => isDeviceSelected(id, sel));
      const next = new Set(sel.ids);
      for (const id of visibleIds) {
        if (sel.mode === 'individual') {
          if (allVisibleSelected) next.delete(id);
          else next.add(id);
        } else {
          if (allVisibleSelected) next.add(id);
          else next.delete(id);
        }
      }
      return { mode: sel.mode, ids: next };
    });
  }, []);

  const selectAllAcross = useCallback(() => {
    setSelection({ mode: 'all-across', ids: new Set<string>() });
  }, []);
  const uncheckAll = useCallback(() => {
    setSelection(EMPTY_SELECTION);
  }, []);
  // Quick-select convenience: flips the picker to individual mode and ticks
  // every currently-online row. Offline devices stay selectable manually —
  // this is a pre-selector, NOT an online-only filter. The backend assigns by
  // target scope and offline devices apply on reconnect.
  const quickSelectOnline = useCallback(() => {
    const onlineIds = new Set<string>();
    for (const d of previewDevices) {
      if (!d.offline) onlineIds.add(d.id);
    }
    setSelection({ mode: 'individual', ids: onlineIds });
  }, [previewDevices]);

  const effectiveSelectedIds = useMemo(() => {
    const set = new Set<string>();
    for (const d of previewDevices) {
      if (isDeviceSelected(d.id, selection)) set.add(d.id);
    }
    return set;
  }, [previewDevices, selection]);

  const tableSelection: TableSelection = useMemo(
    () => ({
      selectedIds: effectiveSelectedIds,
      onToggleRow,
      onToggleVisible: onTogglePage,
    }),
    [effectiveSelectedIds, onToggleRow, onTogglePage],
  );

  const previewColumns: readonly Column<PreviewDevice>[] = useMemo(
    () => [
      {
        key: 'name',
        header: t('assignContentDrawer.columnDevice'),
        render: (d) => (
          <div className="oa-preview__device">
            <span className="oa-preview__device-name">
              {d.name || t('assignContentDrawer.deviceFallbackName', { id: d.id })}
            </span>
            {d.serialNumber !== '' && (
              <code className="oa-mono oa-preview__device-serial">{d.serialNumber}</code>
            )}
          </div>
        ),
      },
      {
        key: 'status',
        header: t('assignContentDrawer.columnStatus'),
        width: '120px',
        render: (d) => (
          <Badge variant={statusBadgeVariant(d.status, d.offline)}>
            {statusLabel(d.status, d.offline)}
          </Badge>
        ),
      },
    ],
    [t],
  );

  const onlineCount = previewDevices.reduce((acc, d) => (d.offline ? acc : acc + 1), 0);

  const selectedTarget = useMemo(
    () => targets.find((tg) => tg.id === targetId) ?? null,
    [targets, targetId],
  );
  const targetDeviceCount = selectedTarget?.deviceCount ?? null;
  const hasZeroDevices = selectedTarget !== null && targetDeviceCount === 0;
  const canContinueFromTargetStep = targetId !== '' && !isLoading && error === null;
  const targetTypeKey = TARGET_TYPES.find((tt) => tt.value === targetType)?.labelKey;
  const targetTypeLabel = targetTypeKey ? t(`assignContentDrawer.${targetTypeKey}`) : '';

  const targetOptions: readonly SearchableSelectOption[] = useMemo(
    () =>
      targets.map((tg) => ({
        value: tg.id,
        label: tg.name,
        meta: t(
          tg.deviceCount === 1
            ? 'assignContentDrawer.devicesOne'
            : 'assignContentDrawer.devicesOther',
          { count: tg.deviceCount },
        ),
      })),
    [targets, t],
  );

  const selectedPlaylist = useMemo(
    () => (playlistId === null ? null : playlists.find((p) => p.id === playlistId) ?? null),
    [playlists, playlistId],
  );
  const canContinueFromPlaylistStep =
    playlistId !== null && !playlistsLoading && playlistsError === null;
  // The drawer only LINKS a playlist to a target; it never adds content. An
  // empty playlist would silently push "nothing to play". Warn the operator;
  // the backend's confirm-time guard is the hard stop.
  const selectedPlaylistIsEmpty = selectedPlaylist !== null && selectedPlaylist.itemCount === 0;

  const playlistOptions: readonly SearchableSelectOption[] = useMemo(
    () =>
      playlists.map((p) => ({
        value: String(p.id),
        label: p.name,
        meta: formatPlaylistMeta(t, p.itemCount, p.totalDurationSeconds),
      })),
    [playlists, t],
  );

  // `min` for the start picker = the current local minute, recomputed each
  // render so it tracks wall-clock time. Past starts can't be picked from the
  // calendar; `scheduleError` below also rejects a typed-in past start.
  const minStartLocal = toLocalInputValue(new Date());

  // Completeness: a required field is still empty and the operator hasn't opted
  // into the explicit "now" / "indefinite" alternative. Surfaced as guidance
  // (not a red error) and blocks Confirm — replaces the old silent default.
  const scheduleIncomplete: string | null = useMemo(() => {
    if (!startNow && startAt === '') return t('assignContentDrawer.setStartTime');
    if (!noEndDate && endAt === '') return t('assignContentDrawer.setEndTime');
    return null;
  }, [startNow, noEndDate, startAt, endAt, t]);

  // Validity: the window the operator entered is wrong (past start, or end not
  // after start). Surfaced as an error. Open-ended cases (start-now / no-end)
  // feed concrete bounds into the comparison so ordering is still checked.
  const scheduleError: string | null = useMemo(() => {
    if (!startNow && startAt !== '') {
      const startMs = new Date(startAt).getTime();
      // One-minute grace: datetime-local has minute granularity, so a start
      // picked "this minute" can land a few seconds behind Date.now().
      if (Number.isFinite(startMs) && startMs < Date.now() - 60_000) {
        return t('assignContentDrawer.startInPast');
      }
    }
    const startMs = startNow ? Date.now() : new Date(startAt).getTime();
    const endMs = noEndDate ? INDEFINITE_END_TIME_MS : new Date(endAt).getTime();
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs <= startMs) {
      return t('assignContentDrawer.endAfterStart');
    }
    return null;
  }, [startNow, noEndDate, startAt, endAt, t]);

  // How many of the operator's selected devices clash, and the denominator to
  // show. `count` is the DEDUPED union of `conflictingDeviceIds` across all
  // conflicts; for an individual (included) selection it is additionally
  // INTERSECTED with the submitted scope, so a stray out-of-scope id from a
  // misbehaving backend can never read as "4 of your 3", and `denominator` is
  // the concrete selected count. All-across has no enumerated scope, so it
  // reports the union with no denominator. `count === 0` (e.g. an older backend
  // that omits `conflictingDeviceIds`) degrades to the generic, non-device-aware
  // header.
  const overlapClash = useMemo<{ count: number; denominator: number | null }>(() => {
    if (overlap === null) return { count: 0, denominator: null };
    const union = new Set<number>();
    for (const c of overlap.conflicts) {
      for (const id of c.conflictingDeviceIds ?? []) union.add(id);
    }
    const scope = confirmSnapshot?.deviceScope;
    if (scope?.kind === 'included') {
      const included = new Set(scope.deviceIds);
      let count = 0;
      for (const id of union) if (included.has(id)) count += 1;
      return { count, denominator: scope.deviceIds.length };
    }
    return { count: union.size, denominator: null };
  }, [overlap, confirmSnapshot]);

  // Per-device subsetting is unsafe when the preview is truncated: we'd
  // derive the device scope from the visible page only, silently
  // excluding every unseen device in the scope. Operators in this case
  // must either assign to the whole scope ('all-across' with no
  // exclusions, or with an explicit exclusion list) or narrow the target.
  const individualSubsetBlocked = selection.mode === 'individual' && truncated;

  const canConfirm =
    !submitting &&
    scheduleError === null &&
    scheduleIncomplete === null &&
    effectiveSelectedCount > 0 &&
    playlistId !== null &&
    !individualSubsetBlocked;

  // Anything past the initial Playlist step zero-state counts as in-progress
  // and earns the "discard" prompt on close attempts.
  const isDirty =
    step > 1 ||
    playlistId !== null ||
    targetId !== '' ||
    selection.ids.size > 0 ||
    startAt !== '' ||
    endAt !== '' ||
    startNow ||
    noEndDate;

  const onCloseRequest = useCallback((): void => {
    if (submitting) return;
    if (isDirty) {
      setDiscardOpen(true);
    } else {
      onClose();
    }
  }, [submitting, isDirty, onClose]);

  // Drop any overlap/error state — used when the operator edits the window
  // (a different time may resolve the conflict) or picks "Choose a different
  // time", so the schedule fields become primary again.
  const clearOverlap = useCallback((): void => {
    setConfirmError(null);
    setOverlap(null);
    setReplaceError(null);
  }, []);

  const assignedDevicesLabel = t(
    effectiveSelectedCount === 1
      ? 'assignContentDrawer.devicesOne'
      : 'assignContentDrawer.devicesOther',
    { count: effectiveSelectedCount },
  );

  // POST /api/assignments (draft). Returns the server id or throws. Shared by
  // the normal confirm and the Replace flow so the draft body stays identical.
  const createDraftAndGetId = async (): Promise<string | number> => {
    const targetTypeApi = (
      { region: 'REGION', facility: 'FACILITY', group: 'DEVICE_GROUP' } as const
    )[targetType];
    const targetIdNum = Number(targetId);
    const draftBody = {
      playlistId,
      targetType: targetTypeApi,
      targetId: Number.isFinite(targetIdNum) ? targetIdNum : 0,
      // "Start now" → this instant; otherwise the operator's explicit local
      // time. `new Date(local).toISOString()` interprets the picker value in
      // the browser zone (Tashkent for our users) — the correct, unchanged
      // conversion; do NOT force/strip a tz here.
      startTime: startNow ? new Date().toISOString() : new Date(startAt).toISOString(),
      // "No end date" → far-future sentinel (the device keeps the content until
      // the assignment is cancelled). Only sent when explicitly chosen, never
      // as a silent fallback for a blank field.
      endTime: noEndDate ? INDEFINITE_END_TIME_ISO : new Date(endAt).toISOString(),
    };
    const draftRes = await http.post<unknown>('/api/assignments', draftBody, {
      _suppressErrorToast: true,
    });
    const data = draftRes.data;
    const rawId =
      typeof data === 'object' && data !== null
        ? (data as Record<string, unknown>).id
        : undefined;
    const draftId = typeof rawId === 'number' || typeof rawId === 'string' ? rawId : null;
    if (draftId === null) {
      // Internal/developer error — not surfaced to the operator, so left as-is.
      throw new Error('Server did not return an assignment id');
    }
    return draftId;
  };

  // POST .../confirm with the operator's chosen device scope, frozen at step
  // 3 → 4 (the live preview has reset to [] on step 4). Sends EXACTLY ONE of
  // `includedDeviceIds` (individual selection) / `excludedDeviceIds` (all-across)
  // — the backend's "at most one" rule — so the device-aware overlap check
  // scopes to the chosen devices. `replace` adds `replaceConflicting: true` for
  // the atomic Replace path.
  const postConfirm = (draftId: string | number, replace: boolean): Promise<unknown> => {
    const scope = confirmSnapshot?.deviceScope;
    const scopeBody =
      scope?.kind === 'included'
        ? { includedDeviceIds: scope.deviceIds }
        : { excludedDeviceIds: scope?.deviceIds ?? [] };
    return http.post(
      `/api/assignments/${encodeURIComponent(String(draftId))}/confirm`,
      { ...scopeBody, ...(replace ? { replaceConflicting: true } : {}) },
      { _suppressErrorToast: true },
    );
  };

  const isOverlap409 = (err: unknown): boolean =>
    axios.isAxiosError(err) && err.response?.status === 409;

  const confirmAssignment = async (): Promise<void> => {
    // canConfirm gates on `playlistId !== null` among other things, so
    // TS narrows `playlistId` to `number` after this guard — no extra
    // null check is needed below.
    if (!canConfirm) return;
    setSubmitting(true);
    clearOverlap();
    try {
      // Overlap is now re-checked device-aware at CONFIRM time only: createDraft
      // 400s on a bad window but never 409s on overlap, so the `isOverlap409`
      // branch below can only be triggered by `postConfirm`. A subset disjoint
      // from existing assignments simply confirms (200) and succeeds.
      const draftId = await createDraftAndGetId();
      await postConfirm(draftId, false);
      notify.success(t('assignContentDrawer.assignedSuccess', { label: assignedDevicesLabel }));
      setSubmitting(false);
      onClose();
    } catch (err: unknown) {
      // This component renders all its confirm failures inline (overlap panel
      // or a notify.error fallback), so suppress the global error modal — incl.
      // an unsuppressed createDraft 400 on a bad window.
      markErrorHandled(err);
      setSubmitting(false);
      // 409 = overlap with an existing CONFIRMED assignment. The raw backend
      // `message` (`Time overlap … [3, 4] for REGION:1`) is developer-facing
      // and leaks ids — never show it. When the structured `details` name the
      // conflicting assignment(s), render the actionable Replace panel; the
      // draft is preserved server-side so the operator can retime or replace.
      if (isOverlap409(err) && axios.isAxiosError(err)) {
        const details = parseOverlapDetails(err.response?.data);
        if (details !== null && details.conflicts.length > 0) {
          setOverlap({ noun: targetTypeLabel.toLowerCase(), conflicts: details.conflicts });
        } else {
          // Only a NON-overlap 409 (details === null) shows its raw backend
          // reason (empty playlist, draft expired, …). An overlap-coded body with
          // no usable conflicts is a *degraded* overlap — keep the generic copy
          // so the id-leaking prose ("… [3, 4] for REGION:1") stays hidden. Gates
          // identically to replaceAndAssign below.
          const nonOverlapMsg = details === null ? extractApiMessage(err) : null;
          setConfirmError(nonOverlapMsg ?? genericOverlapMessage(t, targetTypeLabel.toLowerCase()));
        }
        return;
      }
      notify.error(extractApiMessage(err) ?? t('assignContentDrawer.couldNotConfirm'));
    }
  };

  // Supersede the conflicting assignment(s) and put the new content live.
  // Atomic first (confirm with `replaceConflicting: true`); if the backend
  // doesn't honor it (still 409s), fall back to cancelling each conflict then
  // re-confirming the same draft. Invoked only after the explicit confirm
  // dialog. Failures land back in the overlap panel so the operator can retry.
  const replaceAndAssign = async (): Promise<void> => {
    if (overlap === null) return;
    setSubmitting(true);
    setReplaceError(null);
    try {
      const draftId = await createDraftAndGetId();
      try {
        await postConfirm(draftId, true);
      } catch (err: unknown) {
        // Anything other than a persistent overlap is a genuine failure.
        if (!isOverlap409(err)) throw err;
        // Backend ignored `replaceConflicting` (older build): remove the
        // conflicts ourselves, then re-confirm the unobstructed draft.
        for (const c of overlap.conflicts) {
          try {
            await http.delete(`/api/assignments/${encodeURIComponent(String(c.id))}`, {
              _suppressErrorToast: true,
            });
          } catch (delErr: unknown) {
            // 404 = the conflict was already removed (e.g. another operator) —
            // exactly the state we wanted, so continue. Anything else is real.
            if (!(axios.isAxiosError(delErr) && delErr.response?.status === 404)) throw delErr;
          }
        }
        await postConfirm(draftId, false);
      }
      notify.success(t('assignContentDrawer.replacedSuccess', { label: assignedDevicesLabel }));
      setReplaceConfirmOpen(false);
      setSubmitting(false);
      onClose();
    } catch (err: unknown) {
      // Inline retry path — claim so an unsuppressed failure (e.g. a createDraft
      // 400) doesn't stack the global modal on the panel.
      markErrorHandled(err);
      setSubmitting(false);
      setReplaceConfirmOpen(false);
      // A fresh overlap (structured details) keeps the generic copy — its
      // id-leaking prose must stay hidden. Any other rejection (empty playlist,
      // draft expired, …) shows its real backend reason.
      const data: unknown = axios.isAxiosError(err) ? err.response?.data : undefined;
      const nonOverlapMsg = parseOverlapDetails(data) === null ? extractApiMessage(err) : null;
      setReplaceError(nonOverlapMsg ?? t('assignContentDrawer.couldNotReplace'));
    }
  };

  const footer =
    step === 1 ? (
      <>
        <Button variant="ghost" onClick={onCloseRequest}>
          {t('assignContentDrawer.cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={!canContinueFromPlaylistStep}
          onClick={() => {
            setStep(2);
          }}
        >
          {t('assignContentDrawer.continue')}
        </Button>
      </>
    ) : step === 2 ? (
      <>
        <Button
          variant="ghost"
          onClick={() => {
            setStep(1);
          }}
        >
          {t('assignContentDrawer.back')}
        </Button>
        <Button
          variant="primary"
          disabled={!canContinueFromTargetStep}
          onClick={() => {
            setStep(3);
          }}
        >
          {t('assignContentDrawer.continue')}
        </Button>
      </>
    ) : step === 3 ? (
      <>
        <Button
          variant="ghost"
          onClick={() => {
            setStep(2);
          }}
        >
          {t('assignContentDrawer.back')}
        </Button>
        <Button
          variant="primary"
          disabled={
            selectedCount === 0 || previewError !== null || individualSubsetBlocked
          }
          onClick={() => {
            // Freeze the device context while the preview is still loaded —
            // step 4 reads this, not the (about-to-reset) live hook.
            {
              const deviceScope = deriveConfirmDeviceScope(selection, previewDevices);
              setConfirmSnapshot({
                // For an individual selection the honest count is the FILTERED
                // inclusion length — a stale id the filter drops must not inflate
                // the summary or the success toast (and it keeps the count equal
                // to the overlap header's denominator). All-across legitimately
                // counts unseen devices via totalDevices − excluded.
                selectedCount:
                  deviceScope.kind === 'included' ? deviceScope.deviceIds.length : selectedCount,
                deviceScope,
              });
            }
            setStep(4);
          }}
        >
          {t('assignContentDrawer.continue')}
        </Button>
      </>
    ) : (
      <>
        <Button
          variant="ghost"
          disabled={submitting}
          onClick={() => {
            setStep(3);
          }}
        >
          {t('assignContentDrawer.back')}
        </Button>
        <Button
          variant="primary"
          disabled={!canConfirm}
          isLoading={submitting}
          onClick={() => {
            void confirmAssignment();
          }}
        >
          {t('assignContentDrawer.confirm')}
        </Button>
      </>
    );

  return (
    <>
      <Drawer
        isOpen={isOpen}
        onClose={onCloseRequest}
        title={t('assignContentDrawer.drawerTitle')}
        side="right"
        size="lg"
        closeOnBackdrop={!submitting}
        footer={footer}
      >
        <div className="oa-assign">
          <ol className="oa-assign__steps" aria-label={t('assignContentDrawer.steps')}>
            {STEP_LABELS.map(({ step: s, labelKey }) => (
              <li
                key={s}
                className={`oa-assign__step${step === s ? ' oa-assign__step--active' : ''}${
                  step > s ? ' oa-assign__step--done' : ''
                }`}
                aria-current={step === s ? 'step' : undefined}
              >
                <span className="oa-assign__step-num">{String(s)}</span>
                <span className="oa-assign__step-label">
                  {t(`assignContentDrawer.${labelKey}`)}
                </span>
              </li>
            ))}
          </ol>

          {step === 1 && (
            <>
              <SearchableSelect
                label={t('assignContentDrawer.choosePlaylist')}
                options={playlistOptions}
                value={playlistId === null ? '' : String(playlistId)}
                onChange={(v) => {
                  const n = Number(v);
                  setPlaylistId(Number.isFinite(n) && n > 0 ? n : null);
                }}
                placeholder={t('assignContentDrawer.searchPlaylists')}
                isLoading={playlistsLoading}
                error={playlistsError ?? undefined}
                onRetry={retryPlaylists}
                emptyText={t('assignContentDrawer.noPlaylists')}
              />

              {selectedPlaylist !== null && (
                <div
                  className={`oa-assign__summary${
                    selectedPlaylistIsEmpty ? ' oa-assign__summary--warn' : ''
                  }`}
                  role="status"
                >
                  <p className="oa-assign__summary-name">{selectedPlaylist.name}</p>
                  <p className="oa-assign__summary-count">
                    {formatPlaylistMeta(
                      t,
                      selectedPlaylist.itemCount,
                      selectedPlaylist.totalDurationSeconds,
                    )}
                  </p>
                  {selectedPlaylistIsEmpty && (
                    <p className="oa-assign__summary-count">
                      {t('assignContentDrawer.emptyPlaylistWarning')}
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <fieldset className="oa-assign__type">
                <legend>{t('assignContentDrawer.targetType')}</legend>
                <div className="oa-assign__type-options" role="radiogroup">
                  {TARGET_TYPES.map((tt) => (
                    <label
                      key={tt.value}
                      className={`oa-assign__type-option${
                        targetType === tt.value ? ' oa-assign__type-option--active' : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name="targetType"
                        value={tt.value}
                        checked={targetType === tt.value}
                        onChange={() => {
                          setTargetType(tt.value);
                        }}
                      />
                      <span>{t(`assignContentDrawer.${tt.labelKey}`)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <SearchableSelect
                label={t('assignContentDrawer.chooseTarget', {
                  type: targetTypeLabel.toLowerCase(),
                })}
                options={targetOptions}
                value={targetId}
                onChange={setTargetId}
                placeholder={t('assignContentDrawer.searchTargets', { type: targetType })}
                isLoading={isLoading}
                error={error ?? undefined}
                onRetry={retry}
                emptyText={t('assignContentDrawer.noMatchingTargets', { type: targetType })}
              />

              {selectedTarget !== null && (
                <div
                  className={`oa-assign__summary${hasZeroDevices ? ' oa-assign__summary--warn' : ''}`}
                  role="status"
                >
                  <p className="oa-assign__summary-name">{selectedTarget.name}</p>
                  {hasZeroDevices ? (
                    <p className="oa-assign__summary-count">
                      <strong>{t('assignContentDrawer.zeroDevicesStrong')}</strong>{' '}
                      {t('assignContentDrawer.zeroDevicesInTarget', { type: targetType })}
                    </p>
                  ) : (
                    <p className="oa-assign__summary-count">
                      <strong>
                        {t(
                          targetDeviceCount === 1
                            ? 'assignContentDrawer.devicesOne'
                            : 'assignContentDrawer.devicesOther',
                          { count: targetDeviceCount ?? 0 },
                        )}
                      </strong>{' '}
                      {t('assignContentDrawer.willReceiveContent')}
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {step === 3 && (
            <div className="oa-preview">
              <div
                className="oa-preview__bar"
                role="region"
                aria-label={t('assignContentDrawer.selectionActions')}
              >
                <span className="oa-preview__count">
                  <strong>{String(selectedCount)}</strong>{' '}
                  {t('assignContentDrawer.selectedOfTotal', { total: totalDevices })}
                  {selection.mode === 'all-across' && (
                    <span className="oa-preview__mode-tag">
                      {t('assignContentDrawer.allMatching')}
                    </span>
                  )}
                </span>
                <div className="oa-preview__bar-actions">
                  {selection.mode === 'individual' && totalDevices > 0 && (
                    <Button variant="ghost" size="sm" onClick={selectAllAcross}>
                      {t('assignContentDrawer.selectAll', { total: totalDevices })}
                    </Button>
                  )}
                  {selectedCount > 0 && (
                    <Button variant="ghost" size="sm" onClick={uncheckAll}>
                      {t('assignContentDrawer.uncheckAll')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={quickSelectOnline}
                    disabled={onlineCount === 0}
                  >
                    {t('assignContentDrawer.quickSelectOnline')}
                  </Button>
                </div>
              </div>

              <p className="oa-preview__note" role="note">
                {t('assignContentDrawer.offlineNote')}
              </p>

              {truncated && (
                <div className="oa-preview__truncation" role="status">
                  <p>
                    {t('assignContentDrawer.showingFirst')}{' '}
                    <strong>{String(previewDevices.length)}</strong>{' '}
                    {t('assignContentDrawer.ofConnector')}{' '}
                    <strong>{String(totalDevices)}</strong> {t('assignContentDrawer.ofDevices')}{' '}
                    {t('assignContentDrawer.truncationNote')}
                  </p>
                  {selection.mode !== 'all-across' && totalDevices > 0 && (
                    <Button variant="primary" size="sm" onClick={selectAllAcross}>
                      {t('assignContentDrawer.selectAllWholeScope', { total: totalDevices })}
                    </Button>
                  )}
                </div>
              )}

              {previewError !== null ? (
                <div className="oa-preview__error" role="alert">
                  <p>{previewError}</p>
                  <Button variant="primary" size="sm" onClick={previewRetry}>
                    {t('assignContentDrawer.retry')}
                  </Button>
                </div>
              ) : (
                <div className="oa-preview__table">
                  <Table
                    columns={previewColumns}
                    data={previewDevices}
                    rowKey={(d) => d.id}
                    isLoading={previewLoading}
                    selection={tableSelection}
                    emptyTitle={t('assignContentDrawer.noMatchingDevices')}
                    emptyDescription={t('assignContentDrawer.noDevicesToPreview')}
                  />
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="oa-schedule">
              <h3>{t('assignContentDrawer.scheduleHeading')}</h3>
              <p className="oa-schedule__hint">{t('assignContentDrawer.scheduleHint')}</p>
              <div className="oa-schedule__fields">
                <div className="oa-field">
                  <label htmlFor="oa-startAt" className="oa-field__label">
                    {t('assignContentDrawer.start')}
                  </label>
                  <input
                    id="oa-startAt"
                    type="datetime-local"
                    className="oa-field__input"
                    value={startAt}
                    min={minStartLocal}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      setStartAt(e.target.value);
                      // Operator is editing times in response to the overlap —
                      // drop the stale notice / conflict panel.
                      clearOverlap();
                    }}
                    disabled={submitting || startNow}
                    required={!startNow}
                    aria-invalid={scheduleError !== null ? true : undefined}
                  />
                  <label className="oa-schedule__toggle">
                    <input
                      type="checkbox"
                      checked={startNow}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        setStartNow(e.target.checked);
                        clearOverlap();
                      }}
                      disabled={submitting}
                    />
                    <span>{t('assignContentDrawer.startNow')}</span>
                  </label>
                </div>
                <div className="oa-field">
                  <label htmlFor="oa-endAt" className="oa-field__label">
                    {t('assignContentDrawer.end')}
                  </label>
                  <input
                    id="oa-endAt"
                    type="datetime-local"
                    className="oa-field__input"
                    value={endAt}
                    min={startNow ? minStartLocal : startAt || minStartLocal}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      setEndAt(e.target.value);
                      clearOverlap();
                    }}
                    disabled={submitting || noEndDate}
                    required={!noEndDate}
                    aria-invalid={scheduleError !== null ? true : undefined}
                    aria-describedby={scheduleError !== null ? 'oa-schedule-error' : undefined}
                  />
                  <label className="oa-schedule__toggle">
                    <input
                      type="checkbox"
                      checked={noEndDate}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        setNoEndDate(e.target.checked);
                        clearOverlap();
                      }}
                      disabled={submitting}
                    />
                    <span>{t('assignContentDrawer.noEndDateToggle')}</span>
                  </label>
                </div>
              </div>
              {scheduleError !== null ? (
                <p id="oa-schedule-error" className="oa-schedule__error" role="alert">
                  {scheduleError}
                </p>
              ) : (
                scheduleIncomplete !== null && (
                  <p className="oa-schedule__hint" role="note">
                    {scheduleIncomplete}
                  </p>
                )
              )}
              {overlap !== null ? (
                // Not a live region itself — focusable controls must not live
                // inside one. The title and the (later) replace error each carry
                // their own role="alert" so both announce on insertion.
                <div className="oa-overlap">
                  <p className="oa-overlap__title" role="alert">
                    {overlapClash.count === 0
                      ? t('assignContentDrawer.bookedOverlap', { noun: overlap.noun })
                      : overlapClash.denominator !== null
                        ? // Individual selection → the denominator is a concrete,
                          // fully-enumerated device count, so "N of your M" is honest.
                          // Two independent plural axes: the noun (device/devices)
                          // agrees with the denominator, the verb (has/have) with
                          // the clash count. denominator===1 implies count===1.
                          t(
                            overlapClash.denominator === 1
                              ? 'assignContentDrawer.clashWithDenominatorOne'
                              : overlapClash.count === 1
                                ? 'assignContentDrawer.clashWithDenominatorOtherHas'
                                : 'assignContentDrawer.clashWithDenominatorOther',
                            { count: overlapClash.count, denominator: overlapClash.denominator },
                          )
                        : // All-across → the selected count includes unseen devices,
                          // so drop the misleading denominator; just name the clash.
                          t(
                            overlapClash.count === 1
                              ? 'assignContentDrawer.clashNoDenominatorOne'
                              : 'assignContentDrawer.clashNoDenominatorOther',
                            { count: overlapClash.count },
                          )}
                  </p>
                  <ul className="oa-overlap__list">
                    {overlap.conflicts.map((c) => (
                      <li key={c.id} className="oa-overlap__item">
                        <span className="oa-overlap__playlist">{conflictPlaylistLabel(t, c)}</span>
                        <span className="oa-overlap__window">{formatConflictWindow(t, c)}</span>
                      </li>
                    ))}
                  </ul>
                  {replaceError !== null && (
                    <p className="oa-overlap__error" role="alert">
                      {replaceError}
                    </p>
                  )}
                  <div className="oa-overlap__actions">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        clearOverlap();
                      }}
                      disabled={submitting}
                    >
                      {t('assignContentDrawer.chooseDifferentTime')}
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => {
                        setReplaceError(null);
                        setReplaceConfirmOpen(true);
                      }}
                      disabled={submitting}
                    >
                      {t('assignContentDrawer.replaceAndAssign')}
                    </Button>
                  </div>
                </div>
              ) : (
                confirmError !== null && (
                  <p className="oa-schedule__error" role="alert">
                    {confirmError}
                  </p>
                )
              )}
              <div className="oa-schedule__summary">
                <p>
                  <strong>
                    {t(
                      effectiveSelectedCount === 1
                        ? 'assignContentDrawer.devicesOne'
                        : 'assignContentDrawer.devicesOther',
                      { count: effectiveSelectedCount },
                    )}
                  </strong>{' '}
                  {t('assignContentDrawer.summaryDevicesReceive', {
                    name: selectedTarget?.name ?? t('assignContentDrawer.noTargetDash'),
                  })}
                </p>
                <p className="oa-schedule__summary-fineprint">
                  {t('assignContentDrawer.summaryFineprint')}
                </p>
              </div>
            </div>
          )}
        </div>
      </Drawer>

      <ConfirmDialog
        isOpen={discardOpen}
        title={t('assignContentDrawer.discardTitle')}
        message={t('assignContentDrawer.discardMessage')}
        confirmLabel={t('assignContentDrawer.discard')}
        cancelLabel={t('assignContentDrawer.keepEditing')}
        variant="danger"
        onCancel={() => {
          setDiscardOpen(false);
        }}
        onConfirm={() => {
          setDiscardOpen(false);
          onClose();
        }}
      />

      <ConfirmDialog
        isOpen={replaceConfirmOpen}
        title={t('assignContentDrawer.replaceTitle')}
        // Names exactly what is removed and what replaces it — this is
        // destructive (it supersedes a live, confirmed assignment), so the
        // operator must opt in with full knowledge, never automatically.
        message={
          overlap === null ? (
            ''
          ) : (
            <>
              <p>
                {overlap.conflicts.length > 1
                  ? t('assignContentDrawer.replaceRemoveOther')
                  : t('assignContentDrawer.replaceRemoveOne')}
              </p>
              <ul className="oa-confirm__list">
                {overlap.conflicts.map((c) => (
                  <li key={c.id}>
                    <strong>{conflictPlaylistLabel(t, c)}</strong> — {formatConflictWindow(t, c)}
                  </li>
                ))}
              </ul>
              <p>
                <Trans
                  i18nKey="assignContentDrawer.replaceRunInstead"
                  values={{
                    name: selectedPlaylist?.name ?? t('assignContentDrawer.newPlaylistFallback'),
                  }}
                  components={[<strong key="name" />]}
                />
              </p>
            </>
          )
        }
        confirmLabel={t('assignContentDrawer.replaceConfirmLabel')}
        cancelLabel={t('assignContentDrawer.cancel')}
        variant="danger"
        onCancel={() => {
          setReplaceConfirmOpen(false);
        }}
        onConfirm={() => replaceAndAssign()}
      />
    </>
  );
};
