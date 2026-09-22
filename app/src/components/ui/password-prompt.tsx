"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n/use-copy";

export function PasswordPrompt({
  title,
  body,
  onSubmit,
}: {
  title: string;
  body: string;
  onSubmit: (password: string) => Promise<void>;
}) {
  const c = useCopy();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  async function submit() {
    setSubmitting(true);
    setError(false);
    try {
      await onSubmit(password);
      setPassword("");
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-canvas/60 p-4">
      <p className="flex items-center gap-1.5 text-sm font-medium text-ink-900">
        <Lock size={14} className="text-ink-400" />
        {title}
      </p>
      <p className="text-xs text-ink-500">{body}</p>
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && password && !submitting && submit()}
          placeholder={c.common.passwordLabel}
          className="min-w-0 flex-1 rounded-lg border border-border-strong px-3 py-2 text-sm text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
        />
        <Button size="sm" disabled={!password || submitting} onClick={submit}>
          {submitting ? c.common.processing : c.common.unlock}
        </Button>
      </div>
      {error && <p className="text-xs text-danger-600">{c.common.wrongPassword}</p>}
    </div>
  );
}
