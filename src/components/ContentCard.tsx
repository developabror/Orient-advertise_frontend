import type { KeyboardEvent, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import type { ContentItem, ContentStatus } from '@hooks/useContentItems';

interface Props {
  item: ContentItem;
  layout: 'grid' | 'list';
  onSchedules?: (id: string) => void;
  onPreview?: (id: string) => void;
  onDelete?: (id: string) => void;
}

const STATUS_VARIANT: Record<ContentStatus, 'success' | 'warning' | 'error' | 'info'> = {
  ready: 'success',
  transcoding: 'info',
  failed: 'error',
  invalid: 'error',
  uploading: 'warning',
};

const formatDuration = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(minutes)}:${String(secs).padStart(2, '0')}`;
};

const formatBytes = (bytes: number): string => {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = value >= 100 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unitIndex] ?? 'B'}`;
};

export const ContentCard = ({ item, layout, onSchedules, onPreview, onDelete }: Props) => {
  const { t } = useTranslation();
  const statusLabel = t(`contentCard.status_${item.status}`);
  const isError = item.status === 'failed' || item.status === 'invalid';
  const isTranscoding = item.status === 'transcoding' || item.status === 'uploading';
  const isReady = item.status === 'ready';
  const errorTitle =
    isError && item.errorMessage !== null && item.errorMessage !== ''
      ? item.errorMessage
      : isError
        ? t('contentCard.processingFailed')
        : undefined;

  // The whole card becomes the click target only for READY rows. We use
  // role="button" + tabIndex (rather than wrapping in a <button>) because the
  // card already contains a real <button> for "Schedules" — nesting one
  // <button> inside another is invalid HTML.
  const clickable = isReady && onPreview !== undefined;

  const activate = (): void => {
    if (clickable) onPreview(item.id);
  };

  const onCardClick = (e: MouseEvent<HTMLElement>): void => {
    if (!clickable) return;
    // Don't fire preview when the user actually wanted the inner button.
    const target = e.target;
    if (target instanceof Element && target.closest('button,a') !== null) return;
    activate();
  };

  const onCardKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    if (!clickable) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate();
    }
  };

  // Delete shows only when the page passed `onDelete` AND the backend says
  // this caller may manage the row (`canManage`). Gating BOTH the action-row
  // wrapper and the button avoids an empty action bar on a granted-not-owned
  // row that also has no Schedules action.
  const canDeleteRow = onDelete !== undefined && item.canManage;

  return (
    <article
      className={`oa-content-card oa-content-card--${layout}${isError ? ' oa-content-card--error' : ''}${clickable ? ' oa-content-card--clickable' : ''}`}
      data-status={item.status}
      title={errorTitle}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? t('contentCard.previewAria', { filename: item.filename }) : undefined}
      onClick={clickable ? onCardClick : undefined}
      onKeyDown={clickable ? onCardKeyDown : undefined}
    >
      <div className="oa-content-card__thumb" aria-hidden="true">
        {item.thumbnailUrl !== null ? (
          <img
            src={item.thumbnailUrl}
            alt=""
            loading="lazy"
            className="oa-content-card__thumb-img"
          />
        ) : (
          <div className="oa-content-card__thumb-placeholder">
            {!isReady && (
              <span className="oa-content-card__thumb-label">
                {isError ? statusLabel : t('contentCard.processing')}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="oa-content-card__head">
        <span className="oa-content-card__filename" title={item.filename}>
          {item.filename}
        </span>
        <div className="oa-content-card__badges">
          {item.urgent && <Badge variant="error">{t('contentCard.urgent')}</Badge>}
          <Badge variant={STATUS_VARIANT[item.status]}>{statusLabel}</Badge>
        </div>
      </div>
      <dl className="oa-content-card__meta">
        <div>
          <dt>{t('contentCard.duration')}</dt>
          <dd>{formatDuration(item.durationSeconds)}</dd>
        </div>
        <div>
          <dt>{t('contentCard.size')}</dt>
          <dd>{formatBytes(item.sizeBytes)}</dd>
        </div>
        <div>
          <dt>{t('contentCard.assignedTo')}</dt>
          <dd>
            {item.assignedTo}{' '}
            {item.assignedTo === 1 ? t('contentCard.device') : t('contentCard.devices')}
          </dd>
        </div>
        {item.uploadedByUsername !== null && (
          <div>
            <dt>{t('contentCard.uploadedBy')}</dt>
            <dd>{item.uploadedByUsername}</dd>
          </div>
        )}
      </dl>
      {isTranscoding && (
        <div
          className="oa-content-card__progress"
          role="progressbar"
          aria-label={t('contentCard.progressAria', { status: statusLabel })}
          aria-valuenow={Math.round(item.progressPct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`${String(Math.round(item.progressPct))}%`}
        >
          <span
            className="oa-content-card__progress-fill"
            style={{ width: `${String(item.progressPct)}%` }}
          />
        </div>
      )}
      {((onSchedules !== undefined && isReady) || canDeleteRow) && (
        <div className="oa-content-card__actions">
          {onSchedules !== undefined && isReady && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onSchedules(item.id);
              }}
            >
              {t('contentCard.schedules')}
            </Button>
          )}
          {canDeleteRow && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(item.id);
              }}
            >
              {t('contentCard.delete')}
            </Button>
          )}
        </div>
      )}
    </article>
  );
};
