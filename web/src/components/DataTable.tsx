import { ReactNode, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
}

interface DataTableProps<T extends { id: string }> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
  total?: number;
  page?: number;
  perPage?: number;
  onPageChange?: (page: number) => void;
  onSort?: (key: string, dir: 'asc' | 'desc') => void;
  onRowClick?: (row: T) => void;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  actions?: (row: T) => ReactNode;
}

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-surface-200 dark:bg-surface-700 rounded animate-pulse" />
        </td>
      ))}
    </tr>
  );
}

export function DataTable<T extends { id: string }>({
  columns,
  data,
  loading = false,
  emptyMessage = 'No records found.',
  total = 0,
  page = 1,
  perPage = 20,
  onPageChange,
  onSort,
  onRowClick,
  sortKey,
  sortDir = 'asc',
  actions,
}: DataTableProps<T>) {
  const [internalSort, setInternalSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  const effectiveSortKey = sortKey ?? internalSort?.key;
  const effectiveSortDir = sortKey ? sortDir : (internalSort?.dir ?? 'asc');

  const handleSort = (key: string) => {
    const newDir = effectiveSortKey === key && effectiveSortDir === 'asc' ? 'desc' : 'asc';
    if (onSort) {
      onSort(key, newDir);
    } else {
      setInternalSort({ key, dir: newDir });
    }
  };

  const totalPages = Math.ceil(total / perPage);
  const hasActions = Boolean(actions);
  const allColumns = hasActions ? [...columns, { key: '__actions', header: '', sortable: false }] : columns;

  return (
    <div className="flex flex-col gap-3">
      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              {allColumns.map((col) => (
                <th
                  key={col.key}
                  style={{ width: col.width }}
                  className={clsx(
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center',
                    col.sortable && 'cursor-pointer select-none hover:text-surface-700 dark:hover:text-surface-200'
                  )}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {col.sortable && (
                      <span className="text-surface-400">
                        {effectiveSortKey === col.key ? (
                          effectiveSortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                        ) : (
                          <ChevronsUpDown size={12} />
                        )}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={allColumns.length} />)
              : data.length === 0
              ? (
                <tr>
                  <td colSpan={allColumns.length} className="py-16 text-center text-surface-400">
                    {emptyMessage}
                  </td>
                </tr>
              )
              : data.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => onRowClick?.(row)}
                  className={clsx(onRowClick && 'cursor-pointer')}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={clsx(
                        col.align === 'right' && 'text-right',
                        col.align === 'center' && 'text-center'
                      )}
                    >
                      {col.render
                        ? col.render(row)
                        : String((row as Record<string, unknown>)[col.key] ?? '')}
                    </td>
                  ))}
                  {hasActions && (
                    <td className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {actions!(row)}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > perPage && (
        <div className="flex items-center justify-between px-1 text-sm text-surface-500">
          <span>
            Showing {Math.min((page - 1) * perPage + 1, total)}–{Math.min(page * perPage, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              className="btn-ghost btn-icon btn-sm"
              disabled={page <= 1}
              onClick={() => onPageChange?.(page - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
              const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
              return (
                <button
                  key={p}
                  className={clsx(
                    'btn btn-sm w-8 rounded-lg text-xs',
                    p === page
                      ? 'bg-primary-600 text-white'
                      : 'btn-ghost'
                  )}
                  onClick={() => onPageChange?.(p)}
                >
                  {p}
                </button>
              );
            })}
            <button
              className="btn-ghost btn-icon btn-sm"
              disabled={page >= totalPages}
              onClick={() => onPageChange?.(page + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
