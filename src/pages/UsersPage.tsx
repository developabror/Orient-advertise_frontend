import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { notify } from '@api/notify';
import { extractApiMessage } from '@api';
import { markErrorHandled } from '@api/errorDialog';
import { useAuth } from '@hooks/useAuth';
import { useUsers, type CreateUserInput, type UserRecord, type UserStatus } from '@hooks/useUsers';
import {
  Badge,
  type BadgeVariant,
  Button,
  type Column,
  ConfirmDialog,
  CreateUserModal,
  EmptyState,
  Pagination,
  SearchInput,
  Select,
  Table,
} from '@components';
import type { Role } from '@api/auth';

const PAGE_SIZE = 20;

const isRole = (v: string): v is Role => v === 'admin' || v === 'operator' || v === 'advertiser';

const isUserStatus = (v: string): v is UserStatus => v === 'active' || v === 'inactive';

const ROLE_BADGE_VARIANT: Record<Role, BadgeVariant> = {
  admin: 'info',
  operator: 'success',
  viewer: 'neutral',
  advertiser: 'neutral',
};

interface ParsedQuery {
  readonly page: number;
  readonly q: string;
  readonly role: '' | Role;
  readonly status: '' | UserStatus;
}

const parseQuery = (params: URLSearchParams): ParsedQuery => {
  const pageParam = Number(params.get('page') ?? '1');
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
  const q = params.get('q') ?? '';
  const r = params.get('role') ?? '';
  const role: '' | Role = r !== '' && isRole(r) ? r : '';
  const s = params.get('status') ?? '';
  const status: '' | UserStatus = s !== '' && isUserStatus(s) ? s : '';
  return { page, q, role, status };
};

export const UsersPage = () => {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const parsed = useMemo(() => parseQuery(searchParams), [searchParams]);

  // Local search input is debounced into the URL so the table doesn't re-fetch
  // on every keystroke.
  const [searchInput, setSearchInput] = useState(parsed.q);
  useEffect(() => {
    setSearchInput(parsed.q);
  }, [parsed.q]);
  useEffect(() => {
    if (searchInput === parsed.q) return;
    const id = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (searchInput === '') next.delete('q');
      else next.set('q', searchInput);
      next.delete('page');
      setSearchParams(next);
    }, 300);
    return () => {
      window.clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const query = useMemo(
    () => ({
      page: parsed.page,
      size: PAGE_SIZE,
      q: parsed.q,
      role: parsed.role,
      status: parsed.status,
    }),
    [parsed.page, parsed.q, parsed.role, parsed.status],
  );

  const { items, totalItems, totalPages, isLoading, error, retry, create, remove } =
    useUsers(query);

  // Spec exposes no server-side filter on /api/users — only `pageable`. Apply
  // the page's filters locally over the page we got back so the UI still
  // reacts to the search/role/status controls.
  const filteredItems = useMemo(() => {
    const q = parsed.q.trim().toLowerCase();
    return items.filter((u) => {
      if (parsed.role !== '' && u.role !== parsed.role) return false;
      if (parsed.status !== '' && u.status !== parsed.status) return false;
      if (q !== '' && !u.name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [items, parsed.q, parsed.role, parsed.status]);

  const setPage = (page: number): void => {
    const next = new URLSearchParams(searchParams);
    if (page <= 1) next.delete('page');
    else next.set('page', String(page));
    setSearchParams(next);
  };

  const setRoleFilter = (role: '' | Role): void => {
    const next = new URLSearchParams(searchParams);
    if (role === '') next.delete('role');
    else next.set('role', role);
    next.delete('page');
    setSearchParams(next);
  };

  const setStatusFilter = (status: '' | UserStatus): void => {
    const next = new URLSearchParams(searchParams);
    if (status === '') next.delete('status');
    else next.set('status', status);
    next.delete('page');
    setSearchParams(next);
  };

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [confirm, setConfirm] = useState<UserRecord | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const onCreate = async (input: CreateUserInput): Promise<void> => {
    await create(input);
    setIsCreateOpen(false);
    notify.success(t('usersPage.toastCreated', { email: input.email }));
  };

  // Spec only supports DELETE for users — there is no deactivate/reactivate
  // toggle. The destructive nature is reflected in the confirm dialog copy.
  const onDelete = (record: UserRecord): void => {
    setConfirm(record);
  };

  const doDelete = async (record: UserRecord): Promise<void> => {
    setPendingId(record.id);
    try {
      await remove(record.id);
      notify.success(t('usersPage.toastDeleted', { email: record.email }));
    } catch (err) {
      markErrorHandled(err);
      notify.error(
        extractApiMessage(err) ?? t('usersPage.toastDeleteFailed', { email: record.email }),
      );
    } finally {
      setPendingId(null);
      setConfirm(null);
    }
  };

  const renderStatusCell = (record: UserRecord): ReactElement => (
    <Badge variant={record.status === 'active' ? 'success' : 'neutral'}>
      {record.status === 'active' ? t('usersPage.statusActive') : t('usersPage.statusInactive')}
    </Badge>
  );

  const renderRoleCell = (record: UserRecord): ReactElement => (
    <div className="oa-users__role-cell">
      <Badge variant={ROLE_BADGE_VARIANT[record.role]}>{t(`usersPage.role_${record.role}`)}</Badge>
      {(record.role === 'advertiser' || record.role === 'operator') && (
        <span className="oa-users__access">
          <span className="oa-users__access-count">
            {t('usersPage.contentLinked', { count: record.linkedContentCount })}
          </span>
          <Link
            to={`/users/${encodeURIComponent(record.id)}/${record.role === 'operator' ? 'operator-access' : 'access'}`}
            className="oa-users__access-link"
          >
            {t('usersPage.manageAccess')}
          </Link>
        </span>
      )}
    </div>
  );

  const renderActionCell = (record: UserRecord): ReactElement => {
    const isSelf = currentUser !== null && record.id === currentUser.sub;
    const isPending = pendingId === record.id;
    return (
      <Button
        variant="danger"
        size="sm"
        onClick={() => {
          onDelete(record);
        }}
        // Self-delete is forbidden — there must always be at least one logged-in
        // admin, and that admin is *this* admin. The server should also reject;
        // this is just the UI guard.
        disabled={isSelf || isPending}
        isLoading={isPending}
        title={isSelf ? t('usersPage.deleteSelfTitle') : t('usersPage.deleteUserTitle')}
        aria-label={t('usersPage.deleteAria', { email: record.email })}
      >
        {t('usersPage.delete')}
      </Button>
    );
  };

  // Spec UserResponse exposes only id/username/role/active. Drop the columns
  // the wire format doesn't carry (Email, Last login).
  const columns: readonly Column<UserRecord>[] = useMemo(
    () => [
      {
        key: 'username',
        header: t('usersPage.colUsername'),
        render: (r) => <span className="oa-mono">{r.name}</span>,
      },
      { key: 'role', header: t('usersPage.colRole'), render: renderRoleCell },
      {
        key: 'status',
        header: t('usersPage.colStatus'),
        width: '120px',
        render: renderStatusCell,
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        width: '120px',
        render: renderActionCell,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUser?.sub, pendingId, t],
  );

  return (
    <section className="oa-users">
      <header className="oa-users__header">
        <div>
          <h1 className="oa-users__title">{t('usersPage.title')}</h1>
          <p className="oa-users__subtitle">{t('usersPage.subtitle')}</p>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            setIsCreateOpen(true);
          }}
        >
          {t('usersPage.createUser')}
        </Button>
      </header>

      <div className="oa-users__filter-bar">
        <SearchInput
          label={t('usersPage.searchLabel')}
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
          }}
          onClear={() => {
            setSearchInput('');
          }}
          placeholder={t('usersPage.searchPlaceholder')}
        />
        <Select
          label={t('usersPage.colRole')}
          options={[
            { value: '', label: t('usersPage.allRoles') },
            { value: 'admin', label: t('usersPage.role_admin') },
            { value: 'operator', label: t('usersPage.role_operator') },
            { value: 'advertiser', label: t('usersPage.role_advertiser') },
          ]}
          value={parsed.role}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '' || isRole(v)) setRoleFilter(v);
          }}
        />
        <Select
          label={t('usersPage.colStatus')}
          options={[
            { value: '', label: t('usersPage.allStatuses') },
            { value: 'active', label: t('usersPage.statusActive') },
            { value: 'inactive', label: t('usersPage.statusInactive') },
          ]}
          value={parsed.status}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '' || isUserStatus(v)) setStatusFilter(v);
          }}
        />
      </div>

      {error !== null ? (
        <div className="oa-advertiser__panel-error" role="alert">
          <p>{error}</p>
          <Button variant="primary" size="sm" onClick={retry}>
            {t('usersPage.retry')}
          </Button>
        </div>
      ) : !isLoading && items.length === 0 ? (
        <EmptyState
          title={t('usersPage.emptyTitle')}
          description={t('usersPage.emptyDescription')}
        />
      ) : (
        <>
          <Table
            columns={columns}
            data={filteredItems}
            rowKey={(r) => r.id}
            isLoading={isLoading}
            rowClassName={(r) => (r.status === 'inactive' ? 'oa-users__row--inactive' : undefined)}
          />
          <div className="oa-users__pagination">
            <span className="oa-users__count">
              {t('usersPage.userCount', { count: totalItems })}
            </span>
            <Pagination currentPage={parsed.page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </>
      )}

      <CreateUserModal
        isOpen={isCreateOpen}
        onClose={() => {
          setIsCreateOpen(false);
        }}
        onCreate={onCreate}
      />

      <ConfirmDialog
        isOpen={confirm !== null}
        title={t('usersPage.confirmTitle')}
        message={
          confirm !== null ? (
            <Trans
              i18nKey="usersPage.confirmMessage"
              values={{ email: confirm.email }}
              components={{ strong: <strong /> }}
            />
          ) : (
            ''
          )
        }
        confirmLabel={t('usersPage.confirmDelete')}
        cancelLabel={t('usersPage.cancel')}
        variant="danger"
        onConfirm={async () => {
          if (confirm !== null) await doDelete(confirm);
        }}
        onCancel={() => {
          setConfirm(null);
        }}
      />
    </section>
  );
};
