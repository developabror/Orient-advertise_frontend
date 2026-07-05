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
  createRegion,
  deleteRegion,
  getRegion,
  isErrorResponse,
  listProjects,
  listRegions,
  updateRegion,
  type ProjectSummary,
  type RegionDetail,
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

interface CreateState {
  readonly projectId: string;
  readonly code: string;
  readonly name: string;
}

const EMPTY_CREATE: CreateState = { projectId: '', code: '', name: '' };

export const RegionsPage = () => {
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

  const [rows, setRows] = useState<readonly RegionRecord[]>([]);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [listError, setListError] = useState<string | null>(null);

  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [drawerData, setDrawerData] = useState<RegionDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState<boolean>(false);

  const [editing, setEditing] = useState<{ code: string; name: string } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState<boolean>(false);

  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [createState, setCreateState] = useState<CreateState>(EMPTY_CREATE);
  const [createCodeError, setCreateCodeError] = useState<string | undefined>(undefined);
  const [createGenericError, setCreateGenericError] = useState<string | null>(null);
  const [createSaving, setCreateSaving] = useState<boolean>(false);

  // Project list (no pagination — small set).
  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((p) => {
        if (!cancelled) setProjects(p);
      })
      .catch(() => {
        // Project picker stays empty; the page still works without it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounce the name search.
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

  // Operators are scoped server-side; show only their assigned projects in the
  // picker (belt-and-suspenders — the backend already narrows listProjects).
  const visibleProjects = useMemo(
    () => (isOperator ? projects.filter((p) => projectIds.includes(p.id)) : projects),
    [isOperator, projects, projectIds],
  );

  // Auto-select the only assigned project so the operator never has to pick.
  useEffect(() => {
    const only = visibleProjects[0];
    if (isOperator && visibleProjects.length === 1 && only !== undefined && projectId === '') {
      setProjectId(String(only.id));
      setPage(0);
    }
  }, [isOperator, visibleProjects, projectId]);

  const load = useCallback(() => {
    setIsLoading(true);
    setListError(null);
    const filters = {
      ...(projectId !== '' ? { projectId: Number.parseInt(projectId, 10) } : {}),
      ...(name !== '' ? { name } : {}),
    };
    listRegions(filters, { page, size: PAGE_SIZE, sort: 'name,asc' })
      .then((res) => {
        setRows(res.content);
        setTotalPages(res.totalPages);
      })
      .catch((err: unknown) => {
        setListError(extractMessage(err) ?? t('regionsPage.errLoadList'));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [projectId, name, page, t]);

  useEffect(() => {
    // Hold the list call until operator scope resolves, and skip it entirely
    // for an operator with zero assigned projects (no pointless round-trip).
    if (!scopeResolved) return;
    if (noProjects) {
      setRows([]);
      setTotalPages(0);
      setIsLoading(false);
      return;
    }
    load();
  }, [load, scopeResolved, noProjects]);

  const projectName = useCallback(
    (id: number): string => projects.find((p) => p.id === id)?.name ?? `#${String(id)}`,
    [projects],
  );

  const projectOptions = useMemo(
    () => [
      // Operators must always be scoped to a concrete project — no "All".
      ...(isOperator ? [] : [{ value: '', label: t('regionsPage.allProjects') }]),
      ...visibleProjects.map((p) => ({ value: String(p.id), label: p.name })),
    ],
    [visibleProjects, isOperator, t],
  );

  const openDrawer = (id: number): void => {
    setDrawerId(id);
    setDrawerData(null);
    setEditing(null);
    setEditError(null);
    setDeleteError(null);
    setDrawerLoading(true);
    getRegion(id)
      .then((d) => {
        setDrawerData(d);
      })
      .catch((err: unknown) => {
        notify.error(extractMessage(err) ?? t('regionsPage.errLoadOne'));
        setDrawerId(null);
      })
      .finally(() => {
        setDrawerLoading(false);
      });
  };

  const closeDrawer = (): void => {
    setDrawerId(null);
    setDrawerData(null);
    setEditing(null);
    setEditError(null);
    setDeleteError(null);
  };

  const startEdit = (): void => {
    if (drawerData === null) return;
    setEditing({ code: drawerData.code, name: drawerData.name });
    setEditError(null);
  };

  const submitEdit = (): void => {
    if (drawerData === null || editing === null) return;
    const patch: { code?: string; name?: string } = {};
    if (editing.code !== drawerData.code) patch.code = editing.code;
    if (editing.name !== drawerData.name) patch.name = editing.name;
    if (patch.code === undefined && patch.name === undefined) {
      setEditing(null);
      return;
    }
    setEditSaving(true);
    setEditError(null);
    updateRegion(drawerData.id, patch)
      .then((d) => {
        setDrawerData(d);
        setEditing(null);
        load();
      })
      .catch((err: unknown) => {
        setEditError(extractMessage(err) ?? t('regionsPage.errSave'));
      })
      .finally(() => {
        setEditSaving(false);
      });
  };

  const submitDelete = async (): Promise<void> => {
    if (drawerData === null) return;
    setDeleteError(null);
    try {
      await deleteRegion(drawerData.id);
      setConfirmDelete(false);
      closeDrawer();
      load();
    } catch (err: unknown) {
      const msg = extractMessage(err) ?? t('regionsPage.errDelete');
      setDeleteError(msg);
      setConfirmDelete(false);
      throw err;
    }
  };

  const submitCreate = (): void => {
    if (createSaving) return;
    setCreateCodeError(undefined);
    setCreateGenericError(null);
    if (createState.projectId === '' || createState.code === '' || createState.name === '') {
      setCreateGenericError(t('regionsPage.errRequired'));
      return;
    }
    setCreateSaving(true);
    createRegion({
      projectId: Number.parseInt(createState.projectId, 10),
      code: createState.code,
      name: createState.name,
    })
      .then(() => {
        setCreateOpen(false);
        setCreateState(EMPTY_CREATE);
        load();
      })
      .catch((err: unknown) => {
        const msg = extractMessage(err) ?? t('regionsPage.errCreate');
        if (axios.isAxiosError(err) && err.response?.status === 409) {
          setCreateCodeError(msg);
        } else {
          setCreateGenericError(msg);
        }
      })
      .finally(() => {
        setCreateSaving(false);
      });
  };

  const columns: readonly Column<RegionRecord>[] = useMemo(
    () => [
      { key: 'name', header: t('regionsPage.colName'), render: (r) => r.name },
      { key: 'code', header: t('regionsPage.colCode'), render: (r) => <code className="oa-mono">{r.code}</code> },
      { key: 'project', header: t('regionsPage.colProject'), render: (r) => projectName(r.projectId) },
      {
        key: 'facilityCount',
        header: t('regionsPage.colFacilities'),
        width: '110px',
        render: (r) => r.facilityCount,
      },
      { key: 'deviceCount', header: t('regionsPage.colDevices'), width: '90px', render: (r) => r.deviceCount },
      {
        key: 'createdAt',
        header: t('regionsPage.colCreated'),
        width: '120px',
        render: (r) => formatDate(r.createdAt),
      },
    ],
    [projectName, t],
  );

  // Hold the operator's render until /api/me lands — avoids an unfiltered
  // flash before assignedProjectIds is known. Admins/viewers resolve instantly.
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
        <h2>{t('regionsPage.heading')}</h2>
        {canMutate && (
          <Button
            variant="primary"
            onClick={() => {
              setCreateState(EMPTY_CREATE);
              setCreateCodeError(undefined);
              setCreateGenericError(null);
              setCreateOpen(true);
            }}
          >
            {t('regionsPage.newRegion')}
          </Button>
        )}
      </header>

      <div className="oa-settings-page__filters">
        <Select
          label={t('regionsPage.projectLabel')}
          options={projectOptions}
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            setPage(0);
          }}
        />
        <SearchInput
          label={t('regionsPage.nameLabel')}
          value={nameInput}
          onChange={(e) => {
            setNameInput(e.target.value);
          }}
          onClear={() => {
            setNameInput('');
            setName('');
            setPage(0);
          }}
          placeholder={t('regionsPage.searchPlaceholder')}
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
            ? t('regionsPage.emptyMatchTitle')
            : t('regionsPage.emptyTitle')
        }
        emptyDescription={
          canMutate ? t('regionsPage.emptyDescMutate') : t('regionsPage.emptyDesc')
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
        title={drawerData?.name ?? t('regionsPage.drawerTitle')}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={closeDrawer}>
              {t('regionsPage.close')}
            </Button>
            {canMutate && drawerData !== null && editing === null && (
              <Button variant="secondary" onClick={startEdit}>
                {t('regionsPage.edit')}
              </Button>
            )}
            {canDelete && drawerData !== null && editing === null && (
              <RoleGate roles={['admin']}>
                <Button
                  variant="danger"
                  onClick={() => {
                    setDeleteError(null);
                    setConfirmDelete(true);
                  }}
                >
                  {t('regionsPage.delete')}
                </Button>
              </RoleGate>
            )}
            {editing !== null && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(null);
                    setEditError(null);
                  }}
                >
                  {t('regionsPage.cancel')}
                </Button>
                <Button variant="primary" onClick={submitEdit} isLoading={editSaving}>
                  {t('regionsPage.save')}
                </Button>
              </>
            )}
          </>
        }
      >
        {drawerLoading && <p className="oa-muted">{t('regionsPage.loading')}</p>}
        {drawerData !== null && editing === null && (
          <div className="oa-settings-detail">
            <div className="oa-settings-detail__row">
              <span className="oa-settings-detail__label">{t('regionsPage.colCode')}</span>
              <code className="oa-mono">{drawerData.code}</code>
            </div>
            <div className="oa-settings-detail__row">
              <span className="oa-settings-detail__label">{t('regionsPage.colProject')}</span>
              <span>{projectName(drawerData.projectId)}</span>
            </div>
            <div className="oa-settings-detail__row">
              <span className="oa-settings-detail__label">{t('regionsPage.colCreated')}</span>
              <span>{formatDate(drawerData.createdAt)}</span>
            </div>

            {deleteError !== null && (
              <div className="oa-settings-page__error" role="alert">
                {deleteError}
              </div>
            )}

            <div className="oa-settings-detail__section">
              <h3>
                {t('regionsPage.facilitiesCount', {
                  count: drawerData.facilities.length,
                })}
              </h3>
              {drawerData.facilities.length === 0 ? (
                <p className="oa-muted">{t('regionsPage.noFacilities')}</p>
              ) : (
                <ul className="oa-settings-detail__list">
                  {drawerData.facilities.map((f) => (
                    <li key={f.id}>
                      <span>{f.name}</span>
                      <span className="oa-muted">{f.address ?? '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        {drawerData !== null && editing !== null && (
          <div className="oa-settings-form">
            <FormInput
              label={t('regionsPage.colCode')}
              value={editing.code}
              onChange={(e) => {
                setEditing({ ...editing, code: e.target.value });
              }}
            />
            <FormInput
              label={t('regionsPage.nameLabel')}
              value={editing.name}
              onChange={(e) => {
                setEditing({ ...editing, name: e.target.value });
              }}
            />
            {editError !== null && <div className="oa-settings-page__error">{editError}</div>}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        isOpen={confirmDelete}
        title={t('regionsPage.confirmDeleteTitle')}
        message={
          drawerData !== null
            ? t('regionsPage.confirmDeleteMessage', { name: drawerData.name })
            : ''
        }
        variant="danger"
        confirmLabel={t('regionsPage.delete')}
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
        title={t('regionsPage.newRegionTitle')}
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
              {t('regionsPage.cancel')}
            </Button>
            <Button variant="primary" onClick={submitCreate} isLoading={createSaving}>
              {t('regionsPage.create')}
            </Button>
          </>
        }
      >
        <div className="oa-settings-form">
          <Select
            label={t('regionsPage.projectLabel')}
            options={[
              { value: '', label: t('regionsPage.selectProject'), disabled: true },
              ...projects.map((p) => ({ value: String(p.id), label: p.name })),
            ]}
            value={createState.projectId}
            onChange={(e) => {
              setCreateState({ ...createState, projectId: e.target.value });
            }}
          />
          <FormInput
            label={t('regionsPage.colCode')}
            value={createState.code}
            onChange={(e) => {
              setCreateState({ ...createState, code: e.target.value });
            }}
            error={createCodeError}
          />
          <FormInput
            label={t('regionsPage.nameLabel')}
            value={createState.name}
            onChange={(e) => {
              setCreateState({ ...createState, name: e.target.value });
            }}
          />
          {createGenericError !== null && (
            <div className="oa-settings-page__error">{createGenericError}</div>
          )}
        </div>
      </Modal>
    </div>
  );
};
