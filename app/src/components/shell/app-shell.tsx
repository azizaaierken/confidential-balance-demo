"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "./sidebar";
import { useDemoStore } from "@/store/demo-store";
import { useCopy } from "@/lib/i18n/use-copy";

const CONNECT_TIMEOUT_MS = 8000;

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [slowConnect, setSlowConnect] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const backendReady = useDemoStore((s) => s.backendReady);
  const backendError = useDemoStore((s) => s.backendError);
  const hydrate = useDemoStore((s) => s.hydrate);
  const language = useDemoStore((s) => s.language);
  const c = useCopy();

  function tryConnect() {
    setSlowConnect(false);
    setAttempt((n) => n + 1);
    hydrate().catch(() => {
      // surfaced via backendError below; nothing further to do here
    });
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional client-mount gate, see comment below
    setMounted(true);
    tryConnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  // The root layout is a server component and can't read the client-side
  // language, so keep <html lang> in step with it here.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    if (backendReady || backendError) return;
    const timer = setTimeout(() => setSlowConnect(true), CONNECT_TIMEOUT_MS);
    return () => clearTimeout(timer);
    // `attempt` forces this timer to restart on every manual retry, since
    // backendReady/backendError alone don't change when a retry is kicked off.
  }, [backendReady, backendError, attempt]);

  // The store starts empty and is populated by a real fetch to the devnet
  // backend after mount, so nothing below can render meaningfully (or match
  // the server-rendered markup) until then.
  if (!mounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas text-sm text-ink-500">
        {c.shell.loading}
      </div>
    );
  }

  if (backendError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-canvas px-6 text-center text-sm text-ink-500">
        <p className="font-medium text-danger-600">{c.shell.backendUnreachableTitle}</p>
        <p className="max-w-md">{backendError}</p>
        <p className="max-w-md text-xs text-ink-400">{c.shell.backendStartHint}</p>
        <button
          onClick={tryConnect}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {c.common.retryButton}
        </button>
      </div>
    );
  }

  if (!backendReady) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-canvas px-6 text-center text-sm text-ink-500">
        <p>{c.shell.connecting}</p>
        {slowConnect && (
          <>
            <p className="max-w-md text-xs text-ink-400">{c.shell.slowConnect}</p>
            <button
              onClick={tryConnect}
              className="rounded-lg border border-border-strong bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-canvas"
            >
              {c.common.retryButton}
            </button>
          </>
        )}
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
