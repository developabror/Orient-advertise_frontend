import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import {
  AssignContentDrawer,
  Button,
  ConfirmDialog,
  ContentCard,
  ContentPreviewModal,
  ContentSchedulesDrawer,
  ContentUploader,
  EmptyState,
  Pagination,
  Select,
  Spinner,
  UrgentUploadModal,
} from '@components';
import { isErrorResponse, retranscodeContent, softDeleteContent } from '@api';
import { markErrorHandled } from '@api/errorDialog';
import { notify } from '@api/notify';
import { useContentItems, useRole, type ContentItem, type ContentItemsQuery } from '@hooks';

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

const PAGE_SIZE = 24;

const STATUS_OPTION_VALUES = [
  '',
  'ready',
  'transcoding',
  'failed',
  'invalid',
  'uploading',
] as const;

const statusOptionKey: Record<(typeof STATUS_OPTION_VALUES)[number], string> = {
  '': 'statusAll',
  ready: 'statusReady',
  transcoding: 'statusTranscoding',
  failed: 'statusFailed',
  invalid: 'statusInvalid',
  uploading: 'statusUploading',
};

const parsePage = (raw: string | null): number => {
  if (raw === null) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
};

type Layout = 'grid' | 'list';

const parseLayout = (raw: string | null): Layout => (raw === 'list' ? 'list' : 'grid');

export const ContentPage = () => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = parsePage(searchParams.get('page'));
  const status = searchParams.get('status') ?? '';
  const layout = parseLayout(searchParams.get('view'));

  const updateParam = useCallback(
    (key: string, value: string): void => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value === '') next.delete(key);
        else next.set(key, value);
        if (key !== 'page' && key !== 'view') next.delete('page');
        return next;
      });
    },
    [setSearchParams],
  );

  const query: ContentItemsQuery = useMemo(
    () => ({ page, size: PAGE_SIZE, status }),
    [page, status],
  );

  const { items, totalPages, totalItems, isLoading, isStale, refresh, patchItem } =
    useContentItems(query);
  const [urgentOpen, setUrgentOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [schedulesContentId, setSchedulesContentId] = useState<string | null>(null);
  const [previewContentId, setPreviewContentId] = useState<string | null>(null);

  // Deleting content (soft-delete) is ADMIN/OPERATOR only; the API enforces it too.
  const role = useRole();
  const canDelete = role === 'admin' || role === 'operator';
  // POST /api/content/{id}/retranscode carries the same ADMIN/OPERATOR guard.
  // Anyone else would get a 403, so they get no button at all.
  const canRetry = role === 'admin' || role === 'operator';
  const [deleteTarget, setDeleteTarget] = useState<ContentItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryErrors, setRetryErrors] = useState<Readonly<Record<string, string>>>({});

  const requestRetry = useCallback(
    (id: string): void => {
      setRetryErrors((prev) => {
        const { [id]: _dropped, ...rest } = prev;
        return rest;
      });
      setRetryingId(id);
      retranscodeContent(Number.parseInt(id, 10))
        .then((res) => {
          // Optimistic: move the card out of its stuck state immediately and
          // let the WS frame / uploader poll drive it the rest of the way.
          // The backend echoes the status it committed; fall back to
          // TRANSCODING when it sends nothing recognisable.
          const next = res.status ?? 'TRANSCODING';
          patchItem(id, {
            status: next === 'TRANSCODING' ? 'transcoding' : 'uploading',
            stalled: false,
            errorMessage: null,
          });
          notify.success(t('contentPage.retryStarted'));
        })
        .catch((err: unknown) => {
          // 409 (wrong status / missing raw object) and 404 carry an
          // operator-facing `message`. Render it on the card — claiming the
          // error first is what stops the global modal, and suppressing
          // without rendering would make Retry a silent no-op.
          const message = extractMessage(err) ?? t('contentPage.retryError');
          setRetryErrors((prev) => ({ ...prev, [id]: message }));
        })
        .finally(() => {
          setRetryingId(null);
        });
    },
    [patchItem, t],
  );

  const requestDelete = useCallback(
    (id: string): void => {
      setDeleteError(null);
      setDeleteTarget(items.find((i) => i.id === id) ?? null);
    },
    [items],
  );

  const schedulesItem = useMemo(
    () => items.find((i) => i.id === schedulesContentId) ?? null,
    [items, schedulesContentId],
  );

  const previewItem = useMemo(
    () => items.find((i) => i.id === previewContentId) ?? null,
    [items, previewContentId],
  );

  const statusOptions = useMemo(
    () =>
      STATUS_OPTION_VALUES.map((value) => ({
        value,
        label: t(`contentPage.${statusOptionKey[value]}`),
      })),
    [t],
  );

  return (
    <section className="oa-content">
      <header className="oa-content__header">
        <div>
          <h1>{t('contentPage.title')}</h1>
          {!isLoading && (
            <p className="oa-content__subtitle">
              {t('contentPage.itemCount', { count: totalItems })}
            </p>
          )}
        </div>
        <div className="oa-content__header-actions">
          {isStale && (
            <span className="oa-dashboard__stale">{t('contentPage.stale')}</span>
          )}
          <Button
            variant="secondary"
            onClick={() => {
              setAssignOpen(true);
            }}
          >
            {t('contentPage.assignContent')}
          </Button>
          <Button
            variant="urgent"
            onClick={() => {
              setUrgentOpen(true);
            }}
          >
            <span aria-hidden="true">⚠</span> {t('contentPage.urgentUpload')}
          </Button>
        </div>
      </header>

      <ContentUploader onItemReady={refresh} />

      <div className="oa-content__toolbar">
        <Select
          label={t('contentPage.statusLabel')}
          options={statusOptions}
          value={status}
          onChange={(e) => {
            updateParam('status', e.target.value);
          }}
        />
        <div className="oa-content__view-toggle" role="group" aria-label={t('contentPage.layout')}>
          <Button
            variant={layout === 'grid' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => {
              updateParam('view', 'grid');
            }}
            aria-pressed={layout === 'grid'}
          >
            {t('contentPage.grid')}
          </Button>
          <Button
            variant={layout === 'list' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => {
              updateParam('view', 'list');
            }}
            aria-pressed={layout === 'list'}
          >
            {t('contentPage.list')}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="oa-content__state">
          <Spinner size="lg" label={t('contentPage.loading')} />
        </div>
      ) : items.length === 0 ? (
        <div className="oa-content__state">
          <EmptyState
            title={status !== '' ? t('contentPage.emptyMatchTitle') : t('contentPage.emptyTitle')}
            description={
              status !== ''
                ? t('contentPage.emptyMatchDesc')
                : role === 'operator'
                  ? t('contentPage.emptyDescOperator')
                  : t('contentPage.emptyDesc')
            }
          />
        </div>
      ) : (
        <div className={`oa-content__items oa-content__items--${layout}`}>
          {items.map((item) => (
            <ContentCard
              key={item.id}
              item={item}
              layout={layout}
              onSchedules={setSchedulesContentId}
              onPreview={setPreviewContentId}
              isRetrying={retryingId === item.id}
              retryError={retryErrors[item.id] ?? null}
              {...(canDelete ? { onDelete: requestDelete } : {})}
              {...(canRetry ? { onRetry: requestRetry } : {})}
            />
          ))}
        </div>
      )}

      <div className="oa-content__pagination">
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={(p) => {
            updateParam('page', String(p));
          }}
        />
      </div>

      <UrgentUploadModal
        isOpen={urgentOpen}
        onClose={() => {
          setUrgentOpen(false);
        }}
      />

      <AssignContentDrawer
        isOpen={assignOpen}
        onClose={() => {
          setAssignOpen(false);
        }}
      />

      <ContentPreviewModal
        contentId={previewContentId}
        filename={previewItem?.filename}
        onClose={() => {
          setPreviewContentId(null);
        }}
      />

      <ContentSchedulesDrawer
        isOpen={schedulesContentId !== null}
        contentId={schedulesContentId}
        // TODO: resolve the active assignment for `schedulesContentId` (e.g.
        // via a lookup endpoint or by lifting the assignmentId into the
        // ContentItem) and pass it through here. Until that's wired the
        // drawer renders empty schedules; create/update still work because
        // they receive `assignmentId` directly through the form input.
        assignmentId={null}
        contentFilename={schedulesItem?.filename}
        onClose={() => {
          setSchedulesContentId(null);
        }}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={t('contentPage.deleteTitle')}
        message={
          deleteTarget !== null ? (
            <>
              <p>{t('contentPage.deleteMessage', { filename: deleteTarget.filename })}</p>
              {deleteError !== null && (
                <p className="oa-confirm__error" role="alert">
                  {deleteError}
                </p>
              )}
            </>
          ) : (
            ''
          )
        }
        variant="danger"
        confirmLabel={t('contentPage.deleteConfirm')}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={async () => {
          if (deleteTarget === null) return;
          setDeleteError(null);
          try {
            await softDeleteContent(Number.parseInt(deleteTarget.id, 10));
            notify.success(t('contentPage.deleteSuccess'));
            setDeleteTarget(null);
            refresh();
          } catch (err: unknown) {
            // 409 = in use by playlists; the backend names them verbatim — show
            // that (and other fall-through 4xx like 404) inline so the operator
            // can act. 403 and 5xx/network are already toasted by the global
            // interceptor, so skip those to avoid a duplicate message. Keep the
            // dialog open + re-enabled either way (rethrow).
            const status = axios.isAxiosError(err) ? err.response?.status : undefined;
            if (status !== undefined && status < 500 && status !== 403) {
              setDeleteError(extractMessage(err) ?? t('contentPage.deleteError'));
            }
            throw err;
          }
        }}
      />
    </section>
  );
};
