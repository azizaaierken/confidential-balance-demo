import { intlLocale } from "./locale";

export function shortenAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

export function formatAmount(value: number, decimals = 2): string {
  return value.toLocaleString(intlLocale(), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(intlLocale(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// Truncates a real hex-encoded ciphertext (from the backend) into a short
// display fingerprint, e.g. "0x3f2a91e0…8b71c4" — never the full amount.
export function shortCiphertext(hex: string): string {
  if (!hex) return "0x0000…0000";
  if (hex.length <= 16) return `0x${hex}`;
  return `0x${hex.slice(0, 8)}…${hex.slice(-6)}`;
}
