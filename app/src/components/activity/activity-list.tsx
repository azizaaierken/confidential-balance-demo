"use client";

import { ActivityEntry, Role } from "@/lib/types";
import { usePagination } from "@/lib/use-pagination";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { ActivityRow } from "./activity-row";

export function ActivityList({
  entries,
  role,
  ownerAccountId,
  emptyLabel = "No activity yet.",
}: {
  entries: ActivityEntry[];
  role: Role;
  ownerAccountId: string;
  emptyLabel?: string;
}) {
  const { paged, ...pagination } = usePagination(entries);

  if (entries.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-ink-500">{emptyLabel}</p>;
  }

  return (
    <div>
      {paged.map((entry) => (
        <ActivityRow key={entry.id} entry={entry} role={role} ownerAccountId={ownerAccountId} />
      ))}
      {pagination.showControls && (
        <PaginationControls
          page={pagination.page}
          pageCount={pagination.pageCount}
          hasPrev={pagination.hasPrev}
          hasNext={pagination.hasNext}
          onPrev={pagination.prev}
          onNext={pagination.next}
        />
      )}
    </div>
  );
}
