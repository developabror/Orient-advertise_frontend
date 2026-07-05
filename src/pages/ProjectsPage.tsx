import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Button,
  type Column,
  ConfirmDialog,
  Drawer,
  EmptyState,
  FormInput,
  Modal,
  RoleGate,
  Spinner,
  Table,
} from '@components';
import {
  createProject,
  deleteProject,
  getProject,
  getProjectOperators,
  isErrorResponse,
  listProjects,
  listUsers,
  renameProject,
  setProjectOperators,
  type ProjectDetail,
  type ProjectSummary,
  type UserResponse,
} from '@api';
import { markErrorHandled } from '@api/errorDialog';
import { notify } from '@api/notify';
import { useRole } from '@hooks/useRole';
import { useAssignedProjects } from '@hooks/useAssignedProjects';

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

export const ProjectsPage = () => {
  const { t } = useTranslation();
  const role = useRole();
  const canMutate = role === 'admin';

  const { isOperator, projectIds, scopeResolved } = useAssignedProjects();
  const noProjects = isOperator && projectIds.length === 0;

  const [rows, setRows] = useState<readonly ProjectSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [listError, setListError] = useState<string | null>(null);

  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [drawerData, setDrawerData] = useState<ProjectDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState<boolean>(false);

  const [editName, setEditName] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [createName, setCreateName] = useState<string>('');
  const [createSaving, setCreateSaving] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | undefined>(undefined);

  // Operators editor (admin-only) — candidates are all OPERATOR users; the
  // selected set is the project's current operators, diffed on save.
  const [operatorCandidates, setOperatorCandidates] = useState<readonly UserResponse[]>([]);
  const [selectedOperatorIds, setSelectedOperatorIds] = useState<ReadonlySet<number>>(
    new Set<number>(),
  );
  const [operatorsLoading, setOperatorsLoading] = useState<boolean>(false);
  const [operatorsSaving, setOperatorsSaving] = useState<boolean>(false);
  const [operatorsError, setOperatorsError] = useState<string | null>(null);

  const load = useCallback(() => {
    setIsLoading(true);
    setListError(null);
    listProjects()
      .then((res) => {
        setRows(res);
      })
      .catch((err: unknown) => {
        setListError(extractMessage(err) ?? t('projectsPage.errLoadProjects'));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [t]);

  useEffect(() => {
    if (!scopeResolved) return;
    if (noProjects) {
      setRows([]);
      setIsLoading(false);
      return;
    }
    load();
  }, [load, scopeResolved, noProjects]);

  // Lazily load the operator-candidate pool once (admin only). There is no
  // server-side role filter on GET /api/users, so filter to OPERATOR locally.
  const loadOperatorCandidates = useCallback(() => {
    if (operatorCandidates.length > 0) return;
    listUsers({ page: 0, size: 100 })
      .then((res) => {
        setOperatorCandidates(res.content.filter((u) => u.role === 'OPERATOR'));
      })
      .catch(() => undefined);
  }, [operatorCandidates.length]);

  const openDrawer = (id: number): void => {
    setDrawerId(id);
    setDrawerData(null);
    setEditName(null);
    setEditError(null);
    setDeleteError(null);
    setOperatorsError(null);
    setSelectedOperatorIds(new Set<number>());
    setDrawerLoading(true);
    getProject(id)
      .then((d) => {
        setDrawerData(d);
      })
      .catch((err: unknown) => {
        notify.error(extractMessage(err) ?? t('projectsPage.errLoadProject'));
        setDrawerId(null);
      })
      .finally(() => {
        setDrawerLoading(false);
      });
    if (canMutate) {
      loadOperatorCandidates();
      setOperatorsLoading(true);
      getProjectOperators(id)
        .then((ops) => {
          setSelectedOperatorIds(new Set(ops.map((o) => o.userId)));
        })
        .catch((err: unknown) => {
          setOperatorsError(extractMessage(err) ?? t('projectsPage.errLoadOperators'));
        })
        .finally(() => {
          setOperatorsLoading(false);
        });
    }
  };

  const toggleOperator = (userId: number): void => {
    setSelectedOperatorIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const submitOperators = (): void => {
    if (drawerData === null || operatorsSaving) return;
    setOperatorsSaving(true);
    setOperatorsError(null);
    setProjectOperators(drawerData.id, Array.from(selectedOperatorIds))
      .then((ops) => {
        setSelectedOperatorIds(new Set(ops.map((o) => o.userId)));
        notify.success(t('projectsPage.operatorsSaved'));
      })
      .catch((err: unknown) => {
        setOperatorsError(extractMessage(err) ?? t('projectsPage.errSaveOperators'));
      })
      .finally(() => {
        setOperatorsSaving(false);
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
    renameProject(drawerData.id, editName)
      .then((d) => {
        setDrawerData(d);
        setEditName(null);
        load();
      })
      .catch((err: unknown) => {
        setEditError(extractMessage(err) ?? t('projectsPage.errSaveChanges'));
      })
      .finally(() => {
        setEditSaving(false);
      });
  };

  const submitDelete = async (): Promise<void> => {
    if (drawerData === null) return;
    setDeleteError(null);
    try {
      await deleteProject(drawerData.id);
      setConfirmDelete(false);
      closeDrawer();
      load();
    } catch (err: unknown) {
      const msg = extractMessage(err) ?? t('projectsPage.errDeleteProject');
      setDeleteError(msg);
      setConfirmDelete(false);
      throw err;
    }
  };

  const submitCreate = (): void => {
    if (createSaving) return;
    setCreateError(undefined);
    if (createName.trim() === '') {
      setCreateError(t('projectsPage.errNameRequired'));
      return;
    }
    setCreateSaving(true);
    createProject({ name: createName.trim() })
      .then(() => {
        setCreateOpen(false);
        setCreateName('');
        load();
      })
      .catch((err: unknown) => {
        setCreateError(extractMessage(err) ?? t('projectsPage.errCreateProject'));
      })
      .finally(() => {
        setCreateSaving(false);
      });
  };

  const columns: readonly Column<ProjectSummary>[] = useMemo(
    () => [
      { key: 'name', header: t('projectsPage.colName'), render: (r) => r.name },
      {
        key: 'regionCount',
        header: t('projectsPage.colRegions'),
        width: '110px',
        render: (r) => r.regionCount,
      },
      {
        key: 'createdAt',
        header: t('projectsPage.colCreated'),
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
        <h2>{t('projectsPage.title')}</h2>
        {canMutate && (
          <Button
            variant="primary"
            onClick={() => {
              setCreateName('');
              setCreateError(undefined);
              setCreateOpen(true);
            }}
          >
            {t('projectsPage.newProject')}
          </Button>
        )}
      </header>

      {listError !== null && <div className="oa-settings-page__error">{listError}</div>}

      <Table
        columns={columns}
        data={rows}
        rowKey={(r) => String(r.id)}
        isLoading={isLoading}
        emptyTitle={t('projectsPage.emptyTitle')}
        emptyDescription={
          canMutate ? t('projectsPage.emptyCreate') : t('projectsPage.emptyReadonly')
        }
        onRowClick={(r) => {
          openDrawer(r.id);
        }}
      />

      <Drawer
        isOpen={drawerId !== null}
        onClose={closeDrawer}
        title={drawerData?.name ?? t('projectsPage.drawerTitle')}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={closeDrawer}>
              {t('projectsPage.close')}
            </Button>
            {canMutate && drawerData !== null && editName === null && (
              <Button
                variant="secondary"
                onClick={() => {
                  setEditName(drawerData.name);
                  setEditError(null);
                }}
              >
                {t('projectsPage.rename')}
              </Button>
            )}
            {canMutate && drawerData !== null && editName === null && (
              <RoleGate roles={['admin']}>
                <Button
                  variant="danger"
                  onClick={() => {
                    setDeleteError(null);
                    setConfirmDelete(true);
                  }}
                >
                  {t('projectsPage.delete')}
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
                  {t('projectsPage.cancel')}
                </Button>
                <Button variant="primary" onClick={submitRename} isLoading={editSaving}>
                  {t('projectsPage.save')}
                </Button>
              </>
            )}
          </>
        }
      >
        {drawerLoading && <p className="oa-muted">{t('projectsPage.loading')}</p>}
        {drawerData !== null && editName === null && (
          <div className="oa-settings-detail">
            <div className="oa-settings-detail__row">
              <span className="oa-settings-detail__label">{t('projectsPage.colCreated')}</span>
              <span>{formatDate(drawerData.createdAt)}</span>
            </div>
            {deleteError !== null && (
              <div className="oa-settings-page__error" role="alert">
                {deleteError}
              </div>
            )}
            <div className="oa-settings-detail__section">
              <h3>{t('projectsPage.regionsCount', { count: drawerData.regions.length })}</h3>
              {drawerData.regions.length === 0 ? (
                <p className="oa-muted">{t('projectsPage.noRegions')}</p>
              ) : (
                <ul className="oa-settings-detail__list">
                  {drawerData.regions.map((r) => (
                    <li key={r.id}>
                      <span>{r.name}</span>
                      <code className="oa-mono">{r.code}</code>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="oa-settings-detail__section">
              <h3>
                {t('projectsPage.deviceGroupsCount', { count: drawerData.deviceGroups.length })}
              </h3>
              {drawerData.deviceGroups.length === 0 ? (
                <p className="oa-muted">{t('projectsPage.noDeviceGroups')}</p>
              ) : (
                <ul className="oa-settings-detail__list">
                  {drawerData.deviceGroups.map((g) => (
                    <li key={g.id}>
                      <span>{g.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {canMutate && (
              <div className="oa-settings-detail__section">
                <h3>{t('projectsPage.operatorsHeading')}</h3>
                <p className="oa-muted">{t('projectsPage.operatorsHint')}</p>
                {operatorsError !== null && (
                  <div className="oa-settings-page__error" role="alert">
                    {operatorsError}
                  </div>
                )}
                {operatorsLoading ? (
                  <p className="oa-muted">{t('projectsPage.operatorsLoading')}</p>
                ) : operatorCandidates.length === 0 ? (
                  <p className="oa-muted">{t('projectsPage.noOperatorCandidates')}</p>
                ) : (
                  <>
                    <ul className="oa-settings-detail__list">
                      {operatorCandidates.map((u) => (
                        <li key={u.id}>
                          <label
                            style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flex: 1 }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedOperatorIds.has(u.id)}
                              onChange={() => {
                                toggleOperator(u.id);
                              }}
                            />
                            <span>{u.username}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={submitOperators}
                      isLoading={operatorsSaving}
                    >
                      {t('projectsPage.operatorsSave')}
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        {drawerData !== null && editName !== null && (
          <div className="oa-settings-form">
            <FormInput
              label={t('projectsPage.colName')}
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
        title={t('projectsPage.deleteConfirmTitle')}
        message={
          drawerData !== null
            ? t('projectsPage.deleteConfirmMsg', { name: drawerData.name })
            : ''
        }
        variant="danger"
        confirmLabel={t('projectsPage.delete')}
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
        title={t('projectsPage.newProjectTitle')}
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
              {t('projectsPage.cancel')}
            </Button>
            <Button variant="primary" onClick={submitCreate} isLoading={createSaving}>
              {t('projectsPage.create')}
            </Button>
          </>
        }
      >
        <div className="oa-settings-form">
          <FormInput
            label={t('projectsPage.colName')}
            value={createName}
            onChange={(e) => {
              setCreateName(e.target.value);
            }}
            error={createError}
          />
        </div>
      </Modal>
    </div>
  );
};
