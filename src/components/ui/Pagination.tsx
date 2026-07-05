import { useTranslation } from 'react-i18next';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  siblingCount?: number;
}

const range = (start: number, end: number): number[] =>
  Array.from({ length: end - start + 1 }, (_, i) => start + i);

const buildPages = (
  current: number,
  total: number,
  sibling: number,
): readonly (number | 'ellipsis-l' | 'ellipsis-r')[] => {
  if (total <= 1) return [];
  const totalShown = sibling * 2 + 5;
  if (totalShown >= total) return range(1, total);

  const left = Math.max(current - sibling, 1);
  const right = Math.min(current + sibling, total);
  const showLeftEllipsis = left > 2;
  const showRightEllipsis = right < total - 1;

  if (!showLeftEllipsis && showRightEllipsis) {
    return [...range(1, sibling * 2 + 3), 'ellipsis-r', total];
  }
  if (showLeftEllipsis && !showRightEllipsis) {
    return [1, 'ellipsis-l', ...range(total - sibling * 2 - 2, total)];
  }
  return [1, 'ellipsis-l', ...range(left, right), 'ellipsis-r', total];
};

export const Pagination = ({
  currentPage,
  totalPages,
  onPageChange,
  siblingCount = 1,
}: PaginationProps) => {
  const { t } = useTranslation();
  if (totalPages <= 1) return null;
  const items = buildPages(currentPage, totalPages, siblingCount);

  return (
    <nav className="oa-pagination" aria-label={t('uiPagination.pagination')}>
      <button
        type="button"
        className="oa-pagination__btn"
        disabled={currentPage <= 1}
        onClick={() => {
          onPageChange(currentPage - 1);
        }}
        aria-label={t('uiPagination.previousPage')}
      >
        ‹
      </button>
      {items.map((p) =>
        p === 'ellipsis-l' || p === 'ellipsis-r' ? (
          <span key={p} className="oa-pagination__ellipsis" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            className={`oa-pagination__btn${p === currentPage ? ' oa-pagination__btn--active' : ''}`}
            onClick={() => {
              onPageChange(p);
            }}
            aria-current={p === currentPage ? 'page' : undefined}
            aria-label={t('uiPagination.page', { page: p })}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        className="oa-pagination__btn"
        disabled={currentPage >= totalPages}
        onClick={() => {
          onPageChange(currentPage + 1);
        }}
        aria-label={t('uiPagination.nextPage')}
      >
        ›
      </button>
    </nav>
  );
};
