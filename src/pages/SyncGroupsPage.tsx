import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
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
  addDevicesToSyncGroup,
  createSyncGroup,
  deleteSyncGroup,
  getSyncGroup,
  isErrorResponse,
  listSyncGroups,
  listDevices,
  listProjects,
  removeDeviceFromSyncGroup,
  renameSyncGroup,
  type AddDevicesResult,
  type SyncGroupDetail,
  type SyncGroupSummary,
  type DeviceListItem,
  type ProjectSummary,
} from '@api';
import { markErrorHandled } from '@api/errorDialog';
import { notify } from '@api/notify';
import { useRole } from '@hooks/useRole';
import { useAssignedProjects } from '@hooks/useAssignedProjects';

const PAGE_SIZE = 20;
const PICKER_PAGE_SIZE = 50;
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

interface AddDevicesPickerState {
  readonly open: boolean;
  readonly loading: boolean;
  readonly candidates: readonly DeviceListItem[];
  readonly selected: ReadonlySet<number>;
  readonly error: string | null;
}

const EMPTY_PICKER: AddDevicesPickerState = {
  open: false,
  loading: false,
  candidates: [],
  selected: new Set<number>(),
  error: null,
};

export const SyncGroupsPage = () => {
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

  const [rows, setRows] = useState<readonly SyncGroupSummary[]>([]);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [listError, setListError] = useState<string | null>(null);

  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [drawerData, setDrawerData] = useState<SyncGroupDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState<boolean>(false);

  const [editName, setEditName] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [createState, setCreateState] = useState<{ projectId: string; name: string }>({
    projectId: '',
    name: '',
  });
  const [createSaving, setCreateSaving] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | undefined>(undefined);

  const [picker, setPicker] = useState<AddDevicesPickerState>(EMPTY_PICKER);
  const [addResult, setAddResult] = useState<AddDevicesResult | null>(null);

  // Project list (no pagination — small set; mirrors RegionsPage).
  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((p) => {
        if (!cancelled) setProjects(p);
      })
      .catch(() => undefined);
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
      ...(projectId !== '' ? { projectId: Number.parseInt(projectId, 10) } : {}),
      ...(name !== '' ? { name } : {}),
    };
    listSyncGroups(filters, { page, size: PAGE_SIZE, sort: 'name,asc' })
      .then((res) => {
        setRows(res.content);
        setTotalPages(res.totalPages);
      })
      .catch((err: unknown) => {
        setListError(extractMessage(err) ?? t('syncGroupsPage.errLoadList'));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [projectId, name, page, t]);

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

  // Operators only see their assigned projects (backend already narrows
  // listProjects; this intersection is belt-and-suspenders).
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

  const projectOptions = useMemo(
    () => [
      // Operators must always be scoped to a concrete project — no "All".
      ...(isOperator ? [] : [{ value: '', label: t('syncGroupsPage.allProjects') }]),
      ...visibleProjects.map((p) => ({ value: String(p.id), label: p.name })),
    ],
    [visibleProjects, isOperator, t],
  );

  const refreshDrawer = useCallback((id: number) => {
    return getSyncGroup(id).then((d) => {
      setDrawerData(d);
      return d;
    });
  }, []);

  const openDrawer = (id: number): void => {
    setDrawerId(id);
    setDrawerData(null);
    setEditName(null);
    setEditError(null);
    setDeleteError(null);
    setAddResult(null);
    setDrawerLoading(true);
    refreshDrawer(id)
      .catch((err: unknown) => {
        notify.error(extractMessage(err) ?? t('syncGroupsPage.errLoadGroup'));
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
    setAddResult(null);
    setPicker(EMPTY_PICKER);
  };

  const submitRename = (): void => {
    if (drawerData === null || editName === null) return;
    if (editName === drawerData.name) {
      setEditName(null);
      return;
    }
    setEditSaving(true);
    setEditError(null);
    renameSyncGroup(drawerData.id, editName)
      .then((d) => {
        setDrawerData(d);
        setEditName(null);
        load();
      })
      .catch((err: unknown) => {
        setEditError(extractMessage(err) ?? t('syncGroupsPage.errSave'));
      })
      .finally(() => {
        setEditSaving(false);
      });
  };

  const submitDelete = async (): Promise<void> => {
    if (drawerData === null) return;
    setDeleteError(null);
    try {
      await deleteSyncGroup(drawerData.id);
      setConfirmDelete(false);
      closeDrawer();
      load();
    } catch (err: unknown) {
      const msg = extractMessage(err) ?? t('syncGroupsPage.errDelete');
      setDeleteError(msg);
      setConfirmDelete(false);
      throw err;
    }
  };

  const submitCreate = (): void => {
    if (createSaving) return;
    setCreateError(undefined);
    if (createState.projectId === '' || createState.name.trim() === '') {
      setCreateError(t('syncGroupsPage.errProjectNameRequired'));
      return;
    }
    setCreateSaving(true);
    createSyncGroup({
      projectId: Number.parseInt(createState.projectId, 10),
      name: createState.name.trim(),
    })
      .then(() => {
        setCreateOpen(false);
        setCreateState({ projectId: '', name: '' });
        load();
      })
      .catch((err: unknown) => {
        setCreateError(extractMessage(err) ?? t('syncGroupsPage.errCreate'));
      })
      .finally(() => {
        setCreateSaving(false);
      });
  };

  const openPicker = (): void => {
    if (drawerData === null) return;
    setPicker({ ...EMPTY_PICKER, open: true, loading: true });
    // Backend `unassigned: true` filter not yet supported. Fall back to
    // fetching by project and filtering `syncGroupId == null` client-side,
    // capped at the first page. We scope by the group's **project** (not a
    // single region): a sync group spans the project's regions, so a
    // region-scoped query would wrongly exclude legal members elsewhere.
    listDevices(
      { projectId: drawerData.projectId },
      { page: 0, size: PICKER_PAGE_SIZE },
    )
      .then((res) => {
        const candidates = res.content.filter((d) => d.syncGroupId === null);
        setPicker({
          open: true,
          loading: false,
          candidates,
          selected: new Set<number>(),
          error: null,
        });
      })
      .catch((err: unknown) => {
        setPicker({
          open: true,
          loading: false,
          candidates: [],
          selected: new Set<number>(),
          error: extractMessage(err) ?? t('syncGroupsPage.errLoadDevices'),
        });
      });
  };

  const togglePicker = (id: number): void => {
    setPicker((prev) => {
      const next = new Set(prev.selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, selected: next };
    });
  };

  const submitAdd = (): void => {
    if (drawerData === null || picker.selected.size === 0) return;
    const ids = Array.from(picker.selected);
    addDevicesToSyncGroup(drawerData.id, ids)
      .then(async (result) => {
        setAddResult(result);
        setPicker(EMPTY_PICKER);
        await refreshDrawer(drawerData.id);
        load();
      })
      .catch((err: unknown) => {
        setPicker((prev) => ({
          ...prev,
          error: extractMessage(err) ?? t('syncGroupsPage.errAddDevices'),
        }));
      });
  };

  const removeMember = (deviceId: number): void => {
    if (drawerData === null) return;
    removeDeviceFromSyncGroup(drawerData.id, deviceId)
      .then(async () => {
        await refreshDrawer(drawerData.id);
        load();
      })
      .catch((err: unknown) => {
        notify.error(extractMessage(err) ?? t('syncGroupsPage.errRemoveDevice'));
      });
  };

  const columns: readonly Column<SyncGroupSummary>[] = useMemo(
    () => [
      { key: 'name', header: t('syncGroupsPage.colName'), render: (r) => r.name },
      { key: 'project', header: t('syncGroupsPage.colProject'), render: (r) => r.projectName },
      {
        key: 'deviceCount',
        header: t('syncGroupsPage.colDevices'),
        width: '110px',
        render: (r) => r.deviceCount,
      },
      {
        key: 'createdAt',
        header: t('syncGroupsPage.colCreated'),
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
        <h2>{t('syncGroupsPage.heading')}</h2>
        {canMutate && (
          <Button
            variant="primary"
            onClick={() => {
              setCreateState({ projectId: '', name: '' });
              setCreateError(undefined);
              setCreateOpen(true);
            }}
          >
            {t('syncGroupsPage.newGroup')}
          </Button>
        )}
      </header>

      <p className="oa-muted">{t('syncGroupsPage.intro')}</p>

      <div className="oa-settings-page__filters">
        <Select
          label={t('syncGroupsPage.colProject')}
          options={projectOptions}
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            setPage(0);
          }}
        />
        <SearchInput
          label={t('syncGroupsPage.colName')}
          value={nameInput}
          onChange={(e) => {
            setNameInput(e.target.value);
          }}
          onClear={() => {
            setNameInput('');
            setName('');
            setPage(0);
          }}
          placeholder={t('syncGroupsPage.searchByName')}
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
            ? t('syncGroupsPage.emptyNoMatch')
            : t('syncGroupsPage.emptyNone')
        }
        emptyDescription={
          canMutate
            ? t('syncGroupsPage.emptyDescMutate')
            : t('syncGroupsPage.emptyDescReadonly')
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
        title={drawerData?.name ?? t('syncGroupsPage.drawerTitle')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={closeDrawer}>
              {t('syncGroupsPage.close')}
            </Button>
            {canMutate && drawerData !== null && editName === null && (
              <Button
                variant="secondary"
                onClick={() => {
                  setEditName(drawerData.name);
                  setEditError(null);
                }}
              >
                {t('syncGroupsPage.rename')}
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
                  {t('syncGroupsPage.delete')}
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
                  {t('syncGroupsPage.cancel')}
                </Button>
                <Button variant="primary" onClick={submitRename} isLoading={editSaving}>
                  {t('syncGroupsPage.save')}
                </Button>
              </>
            )}
          </>
        }
      >
        {drawerLoading && <p className="oa-muted">{t('syncGroupsPage.loading')}</p>}
        {drawerData !== null && editName === null && (
          <div className="oa-settings-detail">
            <div className="oa-settings-detail__row">
              <span className="oa-settings-detail__label">{t('syncGroupsPage.colProject')}</span>
              <span>{drawerData.projectName}</span>
            </div>
            <div className="oa-settings-detail__row">
              <span className="oa-settings-detail__label">{t('syncGroupsPage.colCreated')}</span>
              <span>{formatDate(drawerData.createdAt)}</span>
            </div>

            {deleteError !== null && (
              <div className="oa-settings-page__error" role="alert">
                {deleteError}
              </div>
            )}

            {addResult !== null && (
              <div className="oa-settings-page__notice">
                <Trans
                  i18nKey="syncGroupsPage.addedCount"
                  values={{ count: addResult.addedCount }}
                  components={{ strong: <strong /> }}
                />
                {addResult.alreadyMember.length > 0 && (
                  <>
                    {' '}
                    {t('syncGroupsPage.alreadyInGroup', {
                      ids: addResult.alreadyMember.map(String).join(', '),
                    })}
                  </>
                )}
                {Object.keys(addResult.movedFrom).length > 0 && (
                  <ul style={{ margin: '0.25rem 0 0 1rem' }}>
                    {Object.entries(addResult.movedFrom).map(([deviceId, prev]) => (
                      <li key={deviceId}>
                        {t('syncGroupsPage.movedFrom', {
                          deviceId,
                          prev: String(prev),
                        })}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="oa-settings-detail__section">
              <div className="oa-settings-detail__actions">
                <h3>{t('syncGroupsPage.members', { count: drawerData.devices.length })}</h3>
                {canMutate && (
                  <Button variant="secondary" size="sm" onClick={openPicker}>
                    {t('syncGroupsPage.addDevicesBtn')}
                  </Button>
                )}
              </div>
              {drawerData.devices.length === 0 ? (
                <p className="oa-muted">{t('syncGroupsPage.noDevicesInGroup')}</p>
              ) : (
                <ul className="oa-settings-detail__list">
                  {drawerData.devices.map((d) => (
                    <li key={d.id}>
                      <span>
                        {d.name}{' '}
                        <span className="oa-muted">
                          <code className="oa-mono">{d.serialNumber}</code> · {d.status}
                        </span>
                      </span>
                      {canMutate && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            removeMember(d.id);
                          }}
                        >
                          {t('syncGroupsPage.remove')}
                        </Button>
                      )}
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
              label={t('syncGroupsPage.colName')}
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
        title={t('syncGroupsPage.confirmDeleteTitle')}
        message={
          drawerData !== null
            ? t('syncGroupsPage.confirmDeleteMessage', { name: drawerData.name })
            : ''
        }
        variant="danger"
        confirmLabel={t('syncGroupsPage.delete')}
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
        title={t('syncGroupsPage.createTitle')}
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
              {t('syncGroupsPage.cancel')}
            </Button>
            <Button variant="primary" onClick={submitCreate} isLoading={createSaving}>
              {t('syncGroupsPage.create')}
            </Button>
          </>
        }
      >
        <div className="oa-settings-form">
          <Select
            label={t('syncGroupsPage.colProject')}
            options={[
              { value: '', label: t('syncGroupsPage.selectProject'), disabled: true },
              ...visibleProjects.map((p) => ({ value: String(p.id), label: p.name })),
            ]}
            value={createState.projectId}
            onChange={(e) => {
              setCreateState({ ...createState, projectId: e.target.value });
            }}
          />
          <FormInput
            label={t('syncGroupsPage.colName')}
            value={createState.name}
            onChange={(e) => {
              setCreateState({ ...createState, name: e.target.value });
            }}
            error={createError}
          />
        </div>
      </Modal>

      <Modal
        isOpen={picker.open}
        onClose={() => {
          setPicker(EMPTY_PICKER);
        }}
        title={t('syncGroupsPage.addDevicesTitle')}
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setPicker(EMPTY_PICKER);
              }}
            >
              {t('syncGroupsPage.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={submitAdd}
              disabled={picker.selected.size === 0 || picker.loading}
            >
              {picker.selected.size > 0
                ? t('syncGroupsPage.addWithCount', { count: picker.selected.size })
                : t('syncGroupsPage.add')}
            </Button>
          </>
        }
      >
        <div className="oa-settings-form">
          <p className="oa-settings-page__notice">
            <Trans
              i18nKey="syncGroupsPage.pickerNotice"
              values={{ count: PICKER_PAGE_SIZE }}
              components={{ code: <code className="oa-mono" /> }}
            />
          </p>
          {picker.loading && <p className="oa-muted">{t('syncGroupsPage.loading')}</p>}
          {picker.error !== null && <div className="oa-settings-page__error">{picker.error}</div>}
          {!picker.loading && picker.candidates.length === 0 && picker.error === null && (
            <p className="oa-muted">{t('syncGroupsPage.noUnassigned')}</p>
          )}
          {picker.candidates.length > 0 && (
            <ul className="oa-settings-detail__list">
              {picker.candidates.map((d) => {
                const checked = picker.selected.has(d.id);
                return (
                  <li key={d.id}>
                    <label
                      style={{
                        display: 'flex',
                        gap: '0.5rem',
                        alignItems: 'center',
                        flex: 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          togglePicker(d.id);
                        }}
                      />
                      <span>{d.name}</span>
                      <span className="oa-muted">
                        <code className="oa-mono">{d.serialNumber}</code>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Modal>
    </div>
  );
};
