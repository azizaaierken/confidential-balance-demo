import { clsx } from "clsx";

const PALETTE = [
  "bg-brand-100 text-brand-700",
  "bg-success-100 text-success-600",
  "bg-warning-100 text-warning-600",
];

function paletteIndex(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % PALETTE.length;
}

export function Avatar({
  initials,
  seed,
  size = "md",
}: {
  initials: string;
  seed: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClass =
    size === "sm" ? "h-7 w-7 text-xs" : size === "lg" ? "h-11 w-11 text-base" : "h-9 w-9 text-sm";
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        sizeClass,
        PALETTE[paletteIndex(seed)]
      )}
    >
      {initials}
    </span>
  );
}
