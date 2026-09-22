import { Loader2, Lock } from "lucide-react";
import { clsx } from "clsx";
import { PrivacyBadge, PrivacyBadgeVariant } from "./badge";

export function BalanceRow({
  label,
  value,
  suffix,
  privacy,
  locked,
  loading,
  accent = "neutral",
}: {
  label: string;
  value: string;
  suffix?: string;
  privacy: PrivacyBadgeVariant;
  locked?: boolean;
  // The owner view is on but its decrypted value has not arrived yet —
  // distinct from `locked`, which is the public view's deliberate mask.
  loading?: boolean;
  accent?: "neutral" | "warning";
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border-subtle px-5 py-4 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-ink-500">{label}</span>
        <PrivacyBadge variant={privacy} />
      </div>
      {loading ? (
        <span
          aria-busy="true"
          className="flex items-center gap-2 text-ink-400"
        >
          <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
          <span className="h-5 w-24 animate-pulse rounded bg-ink-900/10 motion-reduce:animate-none" />
        </span>
      ) : locked ? (
        <span className="flex items-center gap-1.5 font-mono text-lg text-ink-400">
          <Lock size={14} />
          ••••••
        </span>
      ) : (
        <span
          className={clsx(
            "text-xl font-semibold tracking-tight",
            accent === "warning" ? "text-warning-600" : "text-ink-900"
          )}
        >
          {value}
          {suffix && <span className="ml-1.5 text-sm font-medium text-ink-400">{suffix}</span>}
        </span>
      )}
    </div>
  );
}
