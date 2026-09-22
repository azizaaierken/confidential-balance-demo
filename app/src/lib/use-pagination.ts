import { useMemo, useState } from "react";

const DEFAULT_PAGE_SIZE = 5;

// Shared "5 items per page" logic for any list-shaped activity/history feed
// in the app (Recent Activity, the Audit Console's transfer and access-record
// lists, etc.) — one place to keep the page size and clamping logic
// consistent instead of re-deriving it per list.
export function usePagination<T>(items: T[], pageSize: number = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const paged = useMemo(
    () => items.slice(currentPage * pageSize, currentPage * pageSize + pageSize),
    [items, currentPage, pageSize]
  );

  return {
    paged,
    page: currentPage,
    pageCount,
    hasPrev: currentPage > 0,
    hasNext: currentPage < pageCount - 1,
    prev: () => setPage((p) => Math.max(0, p - 1)),
    next: () => setPage((p) => Math.min(pageCount - 1, p + 1)),
    showControls: items.length > pageSize,
  };
}
