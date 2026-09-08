export function shortenAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

export function formatAmount(value: number, decimals = 2): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function relativeTime(ts: number, now: number): string {
  const diffMs = now - ts;
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

const BASE58 =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function randomBase58(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += BASE58[Math.floor(Math.random() * BASE58.length)];
  }
  return out;
}

export function fakeSignature(): string {
  return randomBase58(88);
}

export function fakeCiphertext(): string {
  // Display stand-in shaped like a base64 twisted-ElGamal ciphertext blob.
  const bytes = Array.from({ length: 24 }, () =>
    Math.floor(Math.random() * 256)
  );
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64;
}

export function fakeAccountAddress(): string {
  return randomBase58(44);
}

// Truncates a real hex-encoded ciphertext (from the backend) into a short
// display fingerprint, e.g. "0x3f2a91e0…8b71c4" — never the full amount.
export function shortCiphertext(hex: string): string {
  if (!hex) return "0x0000…0000";
  if (hex.length <= 16) return `0x${hex}`;
  return `0x${hex.slice(0, 8)}…${hex.slice(-6)}`;
}
