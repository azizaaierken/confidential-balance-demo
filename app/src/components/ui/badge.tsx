import { Eye, Lock, Unlock, FlaskConical, Link2, AlertTriangle, CircleCheck, CircleX, Clock } from "lucide-react";
import { clsx } from "clsx";
import { useCopy } from "@/lib/i18n/use-copy";

export type PrivacyBadgeVariant =
  | "public"
  | "owner-only"
  | "encrypted"
  | "demo-simulation"
  | "on-chain-evidence";

const PRIVACY_ICON: Record<PrivacyBadgeVariant, React.ElementType> = {
  public: Eye,
  "owner-only": Unlock,
  encrypted: Lock,
  "demo-simulation": FlaskConical,
  "on-chain-evidence": Link2,
};

// Purple is reserved for interactive controls (buttons, active nav/tabs) so it
// stays meaningful. These are passive classification labels, not actions, so
// public/owner-only/encrypted share one neutral treatment — icon and text
// carry the distinction. demo-simulation and on-chain-evidence are more like
// status indicators (is this real or a stand-in?), so they keep color.
const PRIVACY_CLASS: Record<PrivacyBadgeVariant, string> = {
  public: "bg-ink-900/5 text-ink-500 border-transparent",
  "owner-only": "bg-ink-900/5 text-ink-500 border-transparent",
  encrypted: "bg-ink-900/5 text-ink-500 border-transparent",
  "demo-simulation": "bg-warning-50 text-warning-600 border-transparent",
  "on-chain-evidence": "bg-success-50 text-success-600 border-transparent",
};

export function PrivacyBadge({
  variant,
  className,
}: {
  variant: PrivacyBadgeVariant;
  className?: string;
}) {
  const c = useCopy();
  const Icon = PRIVACY_ICON[variant];
  const label = {
    public: c.common.public,
    "owner-only": c.common.ownerOnly,
    encrypted: c.common.encryptedOnChain,
    "demo-simulation": c.common.demoSimulation,
    "on-chain-evidence": c.common.onChainEvidence,
  }[variant];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        PRIVACY_CLASS[variant],
        className
      )}
    >
      <Icon size={11} strokeWidth={2.5} />
      {label}
    </span>
  );
}

export type StatusVariant = "confirmed" | "pending" | "failed";

const STATUS_ICON: Record<StatusVariant, React.ElementType> = {
  confirmed: CircleCheck,
  pending: Clock,
  failed: CircleX,
};

const STATUS_CLASS: Record<StatusVariant, string> = {
  confirmed: "text-success-600",
  pending: "text-warning-600",
  failed: "text-danger-600",
};

export function StatusBadge({ status }: { status: StatusVariant }) {
  const c = useCopy();
  const Icon = STATUS_ICON[status];
  const label = { confirmed: c.common.confirmed, pending: c.common.pending, failed: c.common.failed }[status];
  return (
    <span className={clsx("inline-flex items-center gap-1 text-xs font-medium", STATUS_CLASS[status])}>
      <Icon size={12} strokeWidth={2.5} />
      {label}
    </span>
  );
}

export function WarningNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-warning-100 bg-warning-50 px-3 py-2 text-sm text-warning-600">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" strokeWidth={2.5} />
      <div>{children}</div>
    </div>
  );
}
