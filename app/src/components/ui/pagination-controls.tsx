import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";
import { useCopy } from "@/lib/i18n/use-copy";

export function PaginationControls({
  page,
  pageCount,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  page: number;
  pageCount: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const c = useCopy();
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border-subtle px-5 py-3">
      <Button size="sm" variant="secondary" disabled={!hasPrev} onClick={onPrev}>
        <ChevronLeft size={14} /> {c.common.previousPage}
      </Button>
      <p className="text-xs text-ink-500">{c.common.pageOf(page + 1, pageCount)}</p>
      <Button size="sm" variant="secondary" disabled={!hasNext} onClick={onNext}>
        {c.common.nextPage} <ChevronRight size={14} />
      </Button>
    </div>
  );
}
