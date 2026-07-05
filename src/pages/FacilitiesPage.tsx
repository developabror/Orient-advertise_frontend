import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
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
  createFacility,
  deleteFacility,
  getFacility,
  isErrorResponse,
  listFacilities,
  listRegions,
  renameFacility,
  type FacilityDetail,
  type FacilitySummary,
  type RegionRecord,
} from '@api';
import { markErrorHandled } from '@api/errorDialog';
import { notify } from '@api/notify';
import { useRole } from '@hooks/useRole';
import { useAssignedProjects } from '@hooks/useAssignedProjects';

const PAGE_SIZE = 20;
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

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
};

export const FacilitiesPage = () => {
  const { t } = useTranslation();
  const role = useRole();
  const canMutate = role === 'admin' || role === 'operator';
  const canDelete = role === 'admin';

  const { isOperator, projectIds, scopeResolved } = useAssignedProjects();
  const noProjects = isOperator && projectIds.length === 0;

  const [regions, setRegions] = useState<readonly RegionRecord[]>([]);
  const [regionId, setRegionId] = useState<string>('');
  const [nameInput, setNameInput] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [page, setPage] = useState<number>(0);

  const [rows, setRows] = useState<readonly FacilitySummary[]>([]);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [listError, setListError] = useState<string | null>(null);

  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [drawerData, setDrawerData] = useState<FacilityDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState<boolean>(false);

  const [editName, setEditName] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [createState, setCreateState] = useState<{ regionId: string; name: string }>({
    regionId: '',
    name: '',
  });
  const [createSaving, setCreateSaving] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Region picker source — same as the assignment-target picker.
  useEffect(() => {
    let cancelled = false;
    listRegions({}, { page: 0, size: 100 })
      .then((p) => {
        if (!cancelled) setRegions(p.content);
      })
      .catch(() => {
        // Best-effort; create form will surface a generic error if needed.
      });
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
      ...(regionId !== '' ? { regionId: Number.parseInt(regionId, 10) } : {}),
      ...(name !== '' ? { name } : {}),
    };
    listFacilities(filters, { page, size: PAGE_SIZE, sort: 'name,asc' })
      .then((res) => {
        setRows(res.content);
        setTotalPages(res.totalPages);
      })
      .catch((err: unknown) => {
        setListError(extractMessage(err) ?? t('facilitiesPage.errLoadList'));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [regionId, name, page, t]);

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

  // Operators only see regions within their assigned projects (backend already
  // narrows listRegions; this intersection is belt-and-suspenders).
  const visibleRegions = useMemo(
    () => (isOperator ? regions.filter((r) => projectIds.includes(r.projectId)) : regions),
    [isOperator, regions, projectIds],
  );

  const regionOptions = useMemo(
    () => [
      { value: '', label: t('facilitiesPage.allRegions') },
      ...visibleRegions.map((r) => ({ value: String(r.id), label: r.name })),
    ],
    [visibleRegions, t],
  );

  const openDrawer = (id: number): void => {
    setDrawerId(id);
    setDrawerData(null);
    setEditName(null);
    setEditError(null);
    setDeleteError(null);
    setDrawerLoading(true);
    getFacility(id)
      .then((d) => {
        setDrawerData(d);
      })
      .catch((err: unknown) => {
        notify.error(extractMessage(err) ?? t('facilitiesPage.errLoadOne'));
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
  };

  const submitRename = (): void => {
    if (drawerData === null || editName === null) return;
    if (editName === drawerData.name) {
      setEditName(null);
      return;
    }
    setEditSaving(true);
    setEditError(null);
    renameFacility(drawerData.id, editName)
      .then((d) => {
        setDrawerData(d);
        setEditName(null);
        load();
      })
      .catch((err: unknown) => {
        setEditError(extractMessage(err) ?? t('facilitiesPage.errSave'));
      })
      .finally(() => {
        setEditSaving(false);
      });
  };

  const submitDelete = async (): Promise<void> => {
    if (drawerData === null) return;
    setDeleteError(null);
    try {
      await deleteFacility(drawerData.id);
      setConfirmDelete(false);
      closeDrawer();
      load();
    } catch (err: unknown) {
      const msg = extractMessage(err) ?? t('facilitiesPage.errDelete');
      setDeleteError(msg);
      setConfirmDelete(false);
      throw err;
    }
  };

  const submitCreate = (): void => {
    if (createSaving) return;
    setCreateError(null);
    if (createState.regionId === '' || createState.name.trim() === '') {
      setCreateError(t('facilitiesPage.errRegionNameRequired'));
      return;
    }
    setCreateSaving(true);
    createFacility({
      regionId: Number.parseInt(createState.regionId, 10),
      name: createState.name.trim(),
    })
      .then(() => {
        setCreateOpen(false);
        setCreateState({ regionId: '', name: '' });
        load();
      })
      .catch((err: unknown) => {
        setCreateError(extractMessage(err) ?? t('facilitiesPage.errCreate'));
      })
      .finally(() => {
        setCreateSaving(false);
      });
  };

  const columns: readonly Column<FacilitySummary>[] = useMemo(
    () => [
      { key: 'name', header: t('facilitiesPage.colName'), render: (r) => r.name },
      { key: 'region', header: t('facilitiesPage.colRegion'), render: (r) => r.regionName },
      {
        key: 'deviceCount',
        header: t('facilitiesPage.colDevices'),
        width: '110px',
        render: (r) => r.deviceCount,
      },
      {
        key: 'createdAt',
        header: t('facilitiesPage.colCreated'),
        width: '120px',
        render: (r) => formatDate(r.createdAt),
      },
    ],
    [t],
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
        <h2>{t('facilitiesPage.heading')}</h2>
        {canMutate && (
          <Button
            variant="primary"
            onClick={() => {
              setCreateState({ regionId: '', name: '' });
              setCreateError(null);
              setCreateOpen(true);
            }}
          >
            {t('facilitiesPage.newFacilityBtn')}
          </Button>
        )}
      </header>

      <div className="oa-settings-page__notice">
        {t('facilitiesPage.noticeRelocate')}
      </div>

      <div className="oa-settings-page__filters">
        <Select
          label={t('facilitiesPage.regionLabel')}
          options={regionOptions}
          value={regionId}
          onChange={(e) => {
            setRegionId(e.target.value);
            setPage(0);
          }}
        />
        <SearchInput
          label={t('facilitiesPage.nameLabel')}
          value={nameInput}
          onChange={(e) => {
            setNameInput(e.target.value);
          }}
          onClear={() => {
            setNameInput('');
            setName('');
            setPage(0);
          }}
          placeholder={t('facilitiesPage.searchPlaceholder')}
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
          regionId !== '' || name !== ''
            ? t('facilitiesPage.emptyTitleFiltered')
            : t('facilitiesPage.emptyTitle')
        }
        emptyDescription={
          canMutate ? t('facilitiesPage.emptyDescMutate') : t('facilitiesPage.emptyDesc')
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
        title={drawerData?.name ?? t('facilitiesPage.drawerTitle')}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={closeDrawer}>
              {t('facilitiesPage.close')}
            </Button>
            {canMutate && drawerData !== null && editName === null && (
              <Button
                variant="secondary"
                onClick={() => {
                  setEditName(drawerData.name);
                  setEditError(null);
                }}
              >
                {t('facilitiesPage.rename')}
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
                  {t('facilitiesPage.delete')}
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
                  {t('facilitiesPage.cancel')}
                </Button>
                <Button variant="primary" onClick={submitRename} isLoading={editSaving}>
                  {t('facilitiesPage.save')}
                </Button>
              </>
            )}
          </>
        }
      >
        {drawerLoading && <p className="oa-muted">{t('facilitiesPage.loading')}</p>}
        {drawerData !== null && editName === null && (
          <div className="oa-settings-detail">
            <div className="oa-settings-detail__row">
              <span className="oa-settings-detail__label">{t('facilitiesPage.regionLabel')}</span>
              <span>{drawerData.regionName}</span>
            </div>
            <div className="oa-settings-detail__row">
              <span className="oa-settings-detail__label">{t('facilitiesPage.addressLabel')}</span>
              <span>{drawerData.address ?? '—'}</span>
            </div>
            <div className="oa-settings-detail__row">
              <span className="oa-settings-detail__label">{t('facilitiesPage.colCreated')}</span>
              <span>{formatDate(drawerData.createdAt)}</span>
            </div>
            <div className="oa-settings-page__notice">
              {t('facilitiesPage.noticeAddressBlocked')}
            </div>
            {deleteError !== null && (
              <div className="oa-settings-page__error" role="alert">
                {deleteError}
              </div>
            )}
            <div className="oa-settings-detail__section">
              <h3>{t('facilitiesPage.devicesHeading', { count: drawerData.devices.length })}</h3>
              {drawerData.devices.length === 0 ? (
                <p className="oa-muted">{t('facilitiesPage.noDevices')}</p>
              ) : (
                <ul className="oa-settings-detail__list">
                  {drawerData.devices.map((d) => (
                    <li key={d.id}>
                      <span>{d.name}</span>
                      <span className="oa-muted">
                        <code className="oa-mono">{d.serialNumber}</code> · {d.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        {drawerData !== null && editName !== null && (
          <div className="oa-settings-form">
            <FormInput
              label={t('facilitiesPage.nameLabel')}
              value={editName}
              onChange={(e) => {
                setEditName(e.target.value);
              }}
            />
            <FormInput
              label={t('facilitiesPage.addressLabel')}
              value={drawerData.address ?? ''}
              hint={t('facilitiesPage.addressHint')}
              disabled
            />
            {editError !== null && <div className="oa-settings-page__error">{editError}</div>}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        isOpen={confirmDelete}
        title={t('facilitiesPage.deleteConfirmTitle')}
        message={
          drawerData !== null
            ? t('facilitiesPage.deleteConfirmMsg', { name: drawerData.name })
            : ''
        }
        variant="danger"
        confirmLabel={t('facilitiesPage.delete')}
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
        title={t('facilitiesPage.newFacilityTitle')}
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
              {t('facilitiesPage.cancel')}
            </Button>
            <Button variant="primary" onClick={submitCreate} isLoading={createSaving}>
              {t('facilitiesPage.create')}
            </Button>
          </>
        }
      >
        <div className="oa-settings-form">
          <Select
            label={t('facilitiesPage.regionLabel')}
            options={[
              { value: '', label: t('facilitiesPage.selectRegion'), disabled: true },
              ...visibleRegions.map((r) => ({ value: String(r.id), label: r.name })),
            ]}
            value={createState.regionId}
            onChange={(e) => {
              setCreateState({ ...createState, regionId: e.target.value });
            }}
          />
          <FormInput
            label={t('facilitiesPage.nameLabel')}
            value={createState.name}
            onChange={(e) => {
              setCreateState({ ...createState, name: e.target.value });
            }}
          />
          {createError !== null && <div className="oa-settings-page__error">{createError}</div>}
        </div>
      </Modal>
    </div>
  );
};
