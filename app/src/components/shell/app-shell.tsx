"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "./sidebar";
import { useDemoStore } from "@/store/demo-store";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const backendReady = useDemoStore((s) => s.backendReady);
  const backendError = useDemoStore((s) => s.backendError);
  const hydrate = useDemoStore((s) => s.hydrate);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional client-mount gate, see comment below
    setMounted(true);
    hydrate().catch(() => {
      // surfaced via backendError below; nothing further to do here
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  // The demo store used to seed itself with randomized ciphertexts/signatures
  // and wall-clock timestamps at module-init time, which could never match
  // between server and client renders. Now it starts empty and is populated
  // by a real fetch to the devnet backend (rust-service) after mount, so
  // gating on mount serves double duty: it avoids the old hydration mismatch
  // and it's the natural place to kick off that fetch.
  if (!mounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas text-sm text-ink-500">
        Loading demo environment…
      </div>
    );
  }

  if (backendError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-canvas px-6 text-center text-sm text-ink-500">
        <p className="font-medium text-danger-600">Could not reach the devnet backend</p>
        <p className="max-w-md">{backendError}</p>
        <p className="max-w-md text-xs text-ink-400">
          Start it with <code className="font-mono">cargo run --bin server</code> in{" "}
          <code className="font-mono">rust-service/</code>, then reload.
        </p>
      </div>
    );
  }

  if (!backendReady) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas text-sm text-ink-500">
        Connecting to devnet backend…
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </div>
  );
}
