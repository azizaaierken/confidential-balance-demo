import { ExternalLink } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "./button";
import { useCopy } from "@/lib/i18n/use-copy";

function solscanUrl(kind: "tx" | "account", value: string): string {
  return `https://solscan.io/${kind === "tx" ? "tx" : "account"}/${value}?cluster=devnet`;
}

// With a signature/address, this is a real devnet Solscan link. Without one
// (an entry the backend recorded no signature for), it stays a disabled,
// tooltipped placeholder rather than a link to nothing.
export function SolscanLink({
  size = "md",
  signature,
  address,
}: {
  size?: "sm" | "md";
  signature?: string;
  address?: string;
}) {
  const c = useCopy();
  const href = signature
    ? solscanUrl("tx", signature)
    : address
      ? solscanUrl("account", address)
      : undefined;

  if (!href) {
    return (
      <Button variant="ghost" size={size} disabled title={c.common.solscanDisabledHint}>
        <ExternalLink size={14} /> {c.common.openInSolscan}
      </Button>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors bg-transparent text-ink-700 hover:bg-ink-900/5",
        size === "sm" ? "px-3 py-1.5 text-sm" : "px-4 py-2.5 text-sm"
      )}
    >
      <ExternalLink size={14} /> {c.common.openInSolscan}
    </a>
  );
}

export function SolscanIconLink({ signature, address }: { signature?: string; address?: string }) {
  const c = useCopy();
  const href = signature
    ? solscanUrl("tx", signature)
    : address
      ? solscanUrl("account", address)
      : undefined;

  if (!href) {
    return (
      <button
        disabled
        title={c.common.solscanDisabledHint}
        aria-label={c.common.openInSolscan}
        className="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-ink-400 disabled:cursor-not-allowed"
      >
        <ExternalLink size={14} />
      </button>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={c.common.openInSolscan}
      aria-label={c.common.openInSolscan}
      className="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-ink-400 hover:bg-canvas hover:text-ink-700"
    >
      <ExternalLink size={14} />
    </a>
  );
}
