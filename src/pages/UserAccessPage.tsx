import { useEffect, useMemo, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { notify } from '@api/notify';
import { extractApiMessage } from '@api';
import { markErrorHandled } from '@api/errorDialog';
import { Badge, type BadgeVariant, Button, EmptyState, SearchInput, Spinner } from '@components';
import { useUserAccess } from '@hooks/useUserAccess';
import { useContentLibrary } from '@hooks/useContentLibrary';
import type { ContentItem, ContentStatus } from '@hooks/useContentItems';

const LIBRARY_PAGE_SIZE = 50;

const STATUS_BADGE: Record<ContentStatus, { variant: BadgeVariant; labelKey: string }> = {
  ready: { variant: 'success', labelKey: 'status_ready' },
  transcoding: { variant: 'info', labelKey: 'status_transcoding' },
  uploading: { variant: 'info', labelKey: 'status_uploading' },
  failed: { variant: 'warning', labelKey: 'status_failed' },
  invalid: { variant: 'warning', labelKey: 'status_invalid' },
};

const ROLE_LABEL_KEY: Record<'admin' | 'operator' | 'viewer' | 'advertiser', string> = {
  admin: 'role_admin',
  operator: 'role_operator',
  viewer: 'role_viewer',
  advertiser: 'role_advertiser',
};

interface ContentRowProps {
  item: ContentItem;
  actionLabel: string;
  actionVariant: 'primary' | 'ghost';
  onAction: () => void;
  isPending: boolean;
}

const ContentRow = ({ item, actionLabel, actionVariant, onAction, isPending }: ContentRowProps) => {
  const { t } = useTranslation();
  const status = STATUS_BADGE[item.status];
  const isWarning = item.status === 'failed' || item.status === 'invalid';
  return (
    <li className="oa-access-row" data-warning={isWarning ? 'true' : undefined}>
      <div className="oa-access-row__main">
        <span className="oa-access-row__filename" title={item.filename}>
          {item.filename}
        </span>
        <span className="oa-access-row__meta">
          <Badge variant={status.variant}>{t(`userAccessPage.${status.labelKey}`)}</Badge>
          {item.errorMessage !== null && item.errorMessage !== '' && (
            <span className="oa-access-row__error" title={item.errorMessage}>
              {item.errorMessage}
            </span>
          )}
        </span>
      </div>
      <Button
        variant={actionVariant}
        size="sm"
        onClick={onAction}
        isLoading={isPending}
        disabled={isPending}
        aria-label={`${actionLabel} ${item.filename}`}
      >
        {actionLabel}
      </Button>
    </li>
  );
};

export const UserAccessPage = () => {
  const { t } = useTranslation();
  const { userId = '' } = useParams<{ userId: string }>();

  const {
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
  } = useUserAccess(userId);

  // Linked column: client-side filter is sufficient — typical advertiser is
  // linked to dozens of items at most.
  const [linkedFilter, setLinkedFilter] = useState('');

  // Library column: server-side search, debounced 300ms before the URL/query
  // updates so a fast typist doesn't fire one request per keystroke.
  const [libraryInput, setLibraryInput] = useState('');
  const [libraryQuery, setLibraryQuery] = useState('');
  useEffect(() => {
    if (libraryInput === libraryQuery) return;
    const id = window.setTimeout(() => {
      setLibraryQuery(libraryInput);
    }, 300);
    return () => {
      window.clearTimeout(id);
    };
  }, [libraryInput, libraryQuery]);

  const library = useContentLibrary(
    useMemo(() => ({ q: libraryQuery, size: LIBRARY_PAGE_SIZE }), [libraryQuery]),
  );

  const linkedIds = useMemo(() => new Set(linked.map((c) => c.id)), [linked]);

  // Hide already-linked items from the right column to keep the two columns
  // strictly disjoint. The set membership check is O(1).
  const availableItems = useMemo(
    () => library.items.filter((c) => !linkedIds.has(c.id)),
    [library.items, linkedIds],
  );

  const linkedFiltered = useMemo(() => {
    const q = linkedFilter.trim().toLowerCase();
    if (q === '') return linked;
    return linked.filter((c) => c.filename.toLowerCase().includes(q));
  }, [linked, linkedFilter]);

  const [pendingId, setPendingId] = useState<string | null>(null);

  const onLink = (item: ContentItem): void => {
    if (pendingId !== null) return;
    setPendingId(item.id);
    void (async () => {
      try {
        await link(item.id);
        // Drop from the right column locally; full refresh would restart
        // pagination and feels jumpy on long lists.
        library.removeLocally(item.id);
        notify.success(t('userAccessPage.toastLinked', { filename: item.filename }));
      } catch (err) {
        markErrorHandled(err);
        notify.error(
          extractApiMessage(err) ?? t('userAccessPage.toastLinkFailed', { filename: item.filename }),
        );
      } finally {
        setPendingId(null);
      }
    })();
  };

  const onUnlink = (item: ContentItem): void => {
    if (pendingId !== null) return;
    setPendingId(item.id);
    void (async () => {
      try {
        await unlink(item.id);
        notify.success(t('userAccessPage.toastUnlinked', { filename: item.filename }));
      } catch (err) {
        markErrorHandled(err);
        notify.error(
          extractApiMessage(err) ??
            t('userAccessPage.toastUnlinkFailed', { filename: item.filename }),
        );
      } finally {
        setPendingId(null);
      }
    })();
  };

  if (notFound) {
    return (
      <section className="oa-access">
        <Link to="/users" className="oa-access__back">
          ← {t('userAccessPage.backToUsers')}
        </Link>
        <EmptyState
          title={t('userAccessPage.userNotFoundTitle')}
          description={t('userAccessPage.userNotFoundDesc')}
        />
      </section>
    );
  }

  if (userError !== null) {
    return (
      <section className="oa-access">
        <Link to="/users" className="oa-access__back">
          ← {t('userAccessPage.backToUsers')}
        </Link>
        <div className="oa-advertiser__panel-error" role="alert">
          <p>{userError}</p>
          <Button variant="primary" size="sm" onClick={retry}>
            {t('userAccessPage.retry')}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="oa-access">
      <Link to="/users" className="oa-access__back">
        ← Back to users
      </Link>

      <header className="oa-access__header">
        <div className="oa-access__title-block">
          {userLoading && user === null ? (
            <div className="oa-access__title-skeleton" aria-hidden="true" />
          ) : (
            <h1 className="oa-access__title">
              {t('userAccessPage.manageAccessTitle', {
                name: user?.name ?? t('userAccessPage.fallbackUser'),
              })}
            </h1>
          )}
          {user !== null && (
            <p className="oa-access__subtitle">
              <span className="oa-mono">{user.email}</span>
              <span className="oa-access__role-tag">
                {t(`userAccessPage.${ROLE_LABEL_KEY[user.role]}`)}
              </span>
            </p>
          )}
        </div>
      </header>

      <div className="oa-access__notice" role="note">
        <Trans
          i18nKey="userAccessPage.notice"
          components={{ strong: <strong /> }}
        />
      </div>

      <div className="oa-access__columns">
        <article className="oa-access__col">
          <header className="oa-access__col-header">
            <h2 className="oa-access__col-title">
              {t('userAccessPage.linkedContent')}
              <span className="oa-access__col-count">{linked.length.toLocaleString()}</span>
            </h2>
          </header>
          <SearchInput
            label={t('userAccessPage.searchLinkedLabel')}
            value={linkedFilter}
            onChange={(e) => {
              setLinkedFilter(e.target.value);
            }}
            onClear={() => {
              setLinkedFilter('');
            }}
            placeholder={t('userAccessPage.filterByFilenamePlaceholder')}
          />

          {linkedError !== null ? (
            <div className="oa-advertiser__panel-error" role="alert">
              <p>{linkedError}</p>
              <Button variant="primary" size="sm" onClick={retry}>
                Retry
              </Button>
            </div>
          ) : linkedLoading ? (
            <div className="oa-access__loading">
              <Spinner label={t('userAccessPage.loadingLinkedContent')} />
            </div>
          ) : linked.length === 0 ? (
            <EmptyState
              title={t('userAccessPage.noContentLinkedTitle')}
              description={t('userAccessPage.noContentLinkedDesc')}
            />
          ) : linkedFiltered.length === 0 ? (
            <EmptyState
              title={t('userAccessPage.noMatchesTitle')}
              description={t('userAccessPage.noLinkedMatchesDesc')}
            />
          ) : (
            <ul className="oa-access-list">
              {linkedFiltered.map((item) => (
                <ContentRow
                  key={item.id}
                  item={item}
                  actionLabel={t('userAccessPage.unlink')}
                  actionVariant="ghost"
                  onAction={() => {
                    onUnlink(item);
                  }}
                  isPending={pendingId === item.id}
                />
              ))}
            </ul>
          )}
        </article>

        <article className="oa-access__col">
          <header className="oa-access__col-header">
            <h2 className="oa-access__col-title">
              {t('userAccessPage.availableLibrary')}
              <span className="oa-access__col-count">{library.totalItems.toLocaleString()}</span>
            </h2>
          </header>
          <SearchInput
            label={t('userAccessPage.searchLibraryLabel')}
            value={libraryInput}
            onChange={(e) => {
              setLibraryInput(e.target.value);
            }}
            onClear={() => {
              setLibraryInput('');
            }}
            placeholder={t('userAccessPage.searchFilenamePlaceholder')}
          />

          {library.error !== null ? (
            <div className="oa-advertiser__panel-error" role="alert">
              <p>{library.error}</p>
              <Button variant="primary" size="sm" onClick={library.retry}>
                Retry
              </Button>
            </div>
          ) : library.isLoading ? (
            <div className="oa-access__loading">
              <Spinner label={t('userAccessPage.loadingLibrary')} />
            </div>
          ) : availableItems.length === 0 ? (
            <EmptyState
              title={
                libraryQuery !== ''
                  ? t('userAccessPage.noMatchesTitle')
                  : t('userAccessPage.nothingToLinkTitle')
              }
              description={
                libraryQuery !== ''
                  ? t('userAccessPage.noLibraryMatchesDesc')
                  : t('userAccessPage.nothingToLinkDesc')
              }
            />
          ) : (
            <>
              <ul className="oa-access-list">
                {availableItems.map((item) => (
                  <ContentRow
                    key={item.id}
                    item={item}
                    actionLabel={t('userAccessPage.link')}
                    actionVariant="primary"
                    onAction={() => {
                      onLink(item);
                    }}
                    isPending={pendingId === item.id}
                  />
                ))}
              </ul>
              {library.hasMore && (
                <div className="oa-access__load-more">
                  <Button
                    variant="ghost"
                    onClick={library.loadMore}
                    isLoading={library.isLoadingMore}
                    disabled={library.isLoadingMore}
                  >
                    {library.isLoadingMore
                      ? t('userAccessPage.loadingMore')
                      : t('userAccessPage.loadMore')}
                  </Button>
                </div>
              )}
            </>
          )}
        </article>
      </div>
    </section>
  );
};
