import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from './Spinner';
import { EmptyState } from './EmptyState';

export interface Column<T> {
  readonly key: string;
  readonly header: ReactNode;
  readonly render: (row: T) => ReactNode;
  readonly width?: string;
  readonly align?: 'left' | 'center' | 'right';
}

export interface TableSelection {
  readonly selectedIds: ReadonlySet<string>;
  readonly onToggleRow: (id: string) => void;
  readonly onToggleVisible: (visibleIds: readonly string[]) => void;
}

interface TableProps<T> {
  columns: readonly Column<T>[];
  data: readonly T[];
  rowKey: (row: T) => string;
  isLoading?: boolean;
  emptyState?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  onRowClick?: (row: T) => void;
  selection?: TableSelection | undefined;
  // Per-row class hook for visual states like "deactivated" / "muted". Returned
  // string is appended after the built-in row classes so callers can layer.
  rowClassName?: (row: T) => string | undefined;
}

export const Table = <T,>({
  columns,
  data,
  rowKey,
  isLoading = false,
  emptyState,
  emptyTitle,
  emptyDescription,
  onRowClick,
  selection,
  rowClassName,
}: TableProps<T>) => {
  const { t } = useTranslation();
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);

  const resolvedEmptyTitle = emptyTitle ?? t('uiTable.emptyTitle');
  const resolvedEmptyDescription = emptyDescription ?? t('uiTable.emptyDescription');

  const visibleIds = data.map(rowKey);
  const allVisibleSelected =
    selection !== undefined &&
    visibleIds.length > 0 &&
    visibleIds.every((id) => selection.selectedIds.has(id));
  const someVisibleSelected =
    selection !== undefined && visibleIds.some((id) => selection.selectedIds.has(id));
  const headerIndeterminate = !allVisibleSelected && someVisibleSelected;

  // Native checkbox indeterminate isn't a JSX prop — sync via DOM property.
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = headerIndeterminate;
    }
  });

  if (isLoading) {
    return (
      <div className="oa-table-state">
        <Spinner label={t('uiTable.loading')} />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="oa-table-state">
        {emptyState ?? (
          <EmptyState title={resolvedEmptyTitle} description={resolvedEmptyDescription} />
        )}
      </div>
    );
  }

  return (
    <div className="oa-table-wrap">
      <table className="oa-table">
        <thead>
          <tr>
            {selection !== undefined && (
              <th scope="col" className="oa-table__select">
                <input
                  ref={headerCheckboxRef}
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={() => {
                    selection.onToggleVisible(visibleIds);
                  }}
                  aria-label={
                    allVisibleSelected
                      ? t('uiTable.deselectAllOnPage')
                      : t('uiTable.selectAllOnPage')
                  }
                />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                style={{ width: col.width, textAlign: col.align ?? 'left' }}
                scope="col"
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => {
            const id = rowKey(row);
            const extra = rowClassName?.(row);
            const className =
              [onRowClick ? 'oa-table__row--clickable' : '', extra ?? '']
                .filter(Boolean)
                .join(' ') || undefined;
            return (
              <tr
                key={id}
                className={className}
                onClick={
                  onRowClick
                    ? () => {
                        onRowClick(row);
                      }
                    : undefined
                }
              >
                {selection !== undefined && (
                  <td className="oa-table__select">
                    {/* Row checkbox is intentionally NOT disabled by status.
                        Consumers like the assignment drawer rely on every
                        row — including offline devices — being selectable;
                        the backend assigns by target scope and offline
                        devices sync on reconnect. Do not add a per-row
                        disabled prop here. */}
                    <input
                      type="checkbox"
                      checked={selection.selectedIds.has(id)}
                      onChange={() => {
                        selection.onToggleRow(id);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      aria-label={t('uiTable.selectRow', { id })}
                    />
                  </td>
                )}
                {columns.map((col) => (
                  <td key={col.key} style={{ textAlign: col.align ?? 'left' }}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
