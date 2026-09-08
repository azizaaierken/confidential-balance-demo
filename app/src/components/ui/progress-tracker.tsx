import { clsx } from "clsx";
import { Check, X, Loader2 } from "lucide-react";

export interface TrackerStep {
  key: string;
  label: string;
}

export function ProgressTracker({
  steps,
  currentIndex,
  failedAtIndex,
}: {
  steps: TrackerStep[];
  currentIndex: number;
  failedAtIndex?: number | null;
}) {
  return (
    <ol className="flex flex-col gap-0">
      {steps.map((step, i) => {
        const isFailed = failedAtIndex === i;
        const isDone = !isFailed && (failedAtIndex == null ? i < currentIndex : i < currentIndex);
        const isActive = !isFailed && i === currentIndex && failedAtIndex == null;
        const isLast = i === steps.length - 1;
        return (
          <li key={step.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={clsx(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold",
                  isFailed &&
                    "border-danger-500 bg-danger-50 text-danger-600",
                  isDone &&
                    !isFailed &&
                    "border-success-500 bg-success-500 text-white",
                  isActive &&
                    "border-brand-600 bg-brand-50 text-brand-700",
                  !isDone &&
                    !isActive &&
                    !isFailed &&
                    "border-border-strong bg-white text-ink-400"
                )}
              >
                {isFailed ? (
                  <X size={14} strokeWidth={3} />
                ) : isDone ? (
                  <Check size={14} strokeWidth={3} />
                ) : isActive ? (
                  <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
                ) : (
                  i + 1
                )}
              </span>
              {!isLast && (
                <span
                  className={clsx(
                    "w-0.5 flex-1 min-h-6",
                    isDone ? "bg-success-500" : "bg-border-strong"
                  )}
                />
              )}
            </div>
            <div className="pb-6 pt-0.5">
              <p
                className={clsx(
                  "text-sm font-medium",
                  isFailed
                    ? "text-danger-600"
                    : isActive
                    ? "text-brand-700"
                    : isDone
                    ? "text-ink-900"
                    : "text-ink-400"
                )}
              >
                {step.label}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
