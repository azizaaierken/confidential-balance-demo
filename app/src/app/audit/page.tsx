"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PrivacyBadge } from "@/components/ui/badge";
import { CiphertextChip } from "@/components/ui/ciphertext-chip";
import { SolscanIconLink } from "@/components/ui/solscan-link";
import { EvidenceSteps } from "@/components/ui/evidence-steps";
import { useDemoStore } from "@/store/demo-store";
import { findPersona, MINT, PERSONAS } from "@/lib/mock-data";
import { formatAmount, formatTimestamp, shortenAddress } from "@/lib/format";
import { clsx } from "clsx";
import {
  Lock,
  Unlock,
  KeyRound,
  ShieldCheck,
  History,
  ScrollText,
  FileQuestion,
} from "lucide-react";
import { useCopy } from "@/lib/i18n/use-copy";
import { stageLabel } from "@/lib/i18n/helpers";

export default function AuditConsolePage() {
  const c = useCopy();
  const activity = useDemoStore((s) => s.activity);
  const auditorKeyGenerations = useDemoStore((s) => s.auditorKeyGenerations);
  const auditDisclosures = useDemoStore((s) => s.auditDisclosures);
  const requestAuditDisclosure = useDemoStore((s) => s.requestAuditDisclosure);
  const rotateAuditorKey = useDemoStore((s) => s.rotateAuditorKey);

  const [unlocked, setUnlocked] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const confidentialTransfers = useMemo(
    () => activity.filter((a) => a.type === "confidential_transfer"),
    [activity]
  );

  const operationalLog = useMemo(() => {
    const disclosureEvents = auditDisclosures.map((d) => ({
      id: d.id,
      timestamp: d.timestamp,
      text:
        d.outcome === "success"
          ? c.audit.logDisclosed(
              d.requestedBy,
              d.activityId.slice(0, 8),
              c.audit.keyGenLabel(
                auditorKeyGenerations.find((g) => g.id === d.keyGenerationId)?.generation ?? 0
              ),
              d.reason
            )
          : c.audit.logWrongKey(d.requestedBy, d.activityId.slice(0, 8)),
    }));
    const rotationEvents = auditorKeyGenerations.map((g) => ({
      id: `rotation-${g.id}`,
      timestamp: g.createdAt,
      text: c.audit.logKeyActivated(c.audit.keyGenLabel(g.generation), g.status === "active"),
    }));
    return [...disclosureEvents, ...rotationEvents].sort((a, b) => b.timestamp - a.timestamp);
  }, [auditDisclosures, auditorKeyGenerations, c]);

  return (
    <>
      <PageHeader
        title={c.audit.title}
        subtitle={c.audit.subtitle}
        showWallet={false}
        actions={
          <Button variant={unlocked ? "secondary" : "primary"} onClick={() => setUnlocked((u) => !u)}>
            {unlocked ? <Unlock size={16} /> : <Lock size={16} />}
            {unlocked ? c.audit.unlockedButton : c.audit.unlockButton}
          </Button>
        }
      />

      <main className="flex flex-col gap-5 px-6 py-6">
        <KeyTimeline generations={auditorKeyGenerations} onRotate={rotateAuditorKey} />

        <Card>
          <CardHeader
            title={c.audit.transfersTitle}
            subtitle={unlocked ? c.audit.transfersSubtitleUnlocked : c.audit.transfersSubtitleLocked}
          />
          <div>
            {confidentialTransfers.map((entry) => {
              const from = findPersona(entry.fromAccountId);
              const to = findPersona(entry.toAccountId);
              const gen = auditorKeyGenerations.find(
                (g) => g.id === entry.confidential?.auditorKeyGenerationId
              );
              const expanded = expandedId === entry.id;
              return (
                <div key={entry.id} className="border-b border-border-subtle last:border-b-0">
                  <div className="flex items-center gap-4 px-5 py-3.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-canvas text-ink-500">
                      <ShieldCheck size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-900">
                        {from?.name} → {to?.name}
                      </p>
                      <p className="font-mono text-xs text-ink-400">
                        {shortenAddress(entry.signature, 6)} · {formatTimestamp(entry.timestamp)} ·{" "}
                        {gen && c.audit.keyGenLabel(gen.generation)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {entry.confidential?.disclosedAmount != null ? (
                        <p className="text-sm font-semibold text-ink-900">
                          {formatAmount(entry.confidential.disclosedAmount)} {MINT.symbol}
                        </p>
                      ) : (
                        <CiphertextChip ciphertext={entry.confidential?.ciphertext ?? ""} />
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!unlocked}
                      onClick={() => setExpandedId(expanded ? null : entry.id)}
                    >
                      {expanded ? c.audit.closeButton : c.audit.requestDisclosure}
                    </Button>
                    <SolscanIconLink signature={entry.signature} />
                  </div>
                  {expanded && (
                    <>
                      {entry.steps.length > 1 && (
                        <div className="border-t border-border-subtle bg-canvas/40 px-5 py-4">
                          <EvidenceSteps steps={entry.steps} />
                        </div>
                      )}
                      <DisclosureForm
                        activityId={entry.id}
                        defaultKeyGenerationId={entry.confidential!.auditorKeyGenerationId}
                        keyGenerations={auditorKeyGenerations}
                        onSubmit={(requestedBy, reason, keyGenerationId) =>
                          requestAuditDisclosure(entry.id, requestedBy, reason, keyGenerationId)
                        }
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <FullHistoryReconstruction unlocked={unlocked} />

        <AgentInvestigationSection />

        <Card>
          <CardHeader title={c.audit.accessRecordTitle} subtitle={c.audit.accessRecordSubtitle} />
          <div className="flex flex-col gap-0">
            {operationalLog.length === 0 && (
              <p className="px-5 py-6 text-center text-sm text-ink-500">{c.audit.accessRecordEmpty}</p>
            )}
            {operationalLog.map((event) => (
              <div key={event.id} className="flex items-start gap-3 border-b border-border-subtle px-5 py-3 text-sm last:border-b-0">
                <History size={14} className="mt-0.5 shrink-0 text-ink-400" />
                <p className="text-ink-700">{event.text}</p>
                <span className="ml-auto shrink-0 text-xs text-ink-400">
                  {formatTimestamp(event.timestamp)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </main>
    </>
  );
}

function FullHistoryReconstruction({ unlocked }: { unlocked: boolean }) {
  const c = useCopy();
  const activity = useDemoStore((s) => s.activity);
  const requestAuditDisclosure = useDemoStore((s) => s.requestAuditDisclosure);
  const [accountId, setAccountId] = useState(PERSONAS[0].id);
  const [reconstructing, setReconstructing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [reconstructedFor, setReconstructedFor] = useState<string | null>(null);

  const scoped = useMemo(
    () =>
      activity
        .filter((a) => a.fromAccountId === accountId || a.toAccountId === accountId)
        .sort((a, b) => a.timestamp - b.timestamp),
    [activity, accountId]
  );

  const typeLabel = (type: string) =>
    ({
      mint: c.activity.mintLabel,
      deposit: c.activity.depositLabel,
      withdraw: c.activity.withdrawLabel,
      confidential_transfer: c.activity.confidentialTransferLabel,
      apply_pending: c.activity.applyPendingLabel,
    })[type] ?? type;

  async function reconstruct() {
    setReconstructing(true);
    setReconstructedFor(null);
    const undisclosed = scoped.filter(
      (a) => a.type === "confidential_transfer" && a.confidential && a.confidential.disclosedAmount == null
    );
    setProgress({ done: 0, total: undisclosed.length });
    for (let i = 0; i < undisclosed.length; i++) {
      const entry = undisclosed[i];
      await requestAuditDisclosure(
        entry.id,
        "Auditor — M. Fung",
        "Full transaction-history reconstruction",
        entry.confidential!.auditorKeyGenerationId
      );
      setProgress({ done: i + 1, total: undisclosed.length });
    }
    setReconstructing(false);
    setReconstructedFor(accountId);
  }

  const totalConfidentialTransfers = scoped.filter((a) => a.type === "confidential_transfer").length;

  return (
    <Card>
      <CardHeader title={c.audit.fullHistoryTitle} subtitle={c.audit.fullHistorySubtitle} />
      <div className="flex flex-col gap-3 px-5 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-medium text-ink-700">
            {c.audit.fullHistorySelectLabel}
            <select
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                setReconstructedFor(null);
                setProgress(null);
              }}
              className="rounded-lg border border-border-strong bg-white px-3 py-1.5 text-sm font-medium text-ink-900"
            >
              {PERSONAS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" variant="secondary" disabled={!unlocked || reconstructing} onClick={reconstruct}>
            <History size={14} />
            {reconstructing
              ? c.audit.fullHistoryProgress(progress?.done ?? 0, progress?.total ?? 0)
              : c.audit.fullHistoryReconstructButton}
          </Button>
        </div>

        {reconstructedFor === accountId && (
          <div className="flex flex-col gap-3">
            <div className="rounded-xl border border-success-100 bg-success-50 p-4 text-sm text-success-600">
              <p className="font-medium">{c.audit.fullHistoryResultTitle}</p>
              <p className="mt-1 text-success-600/90">
                {c.audit.fullHistoryResultNote(totalConfidentialTransfers)}
              </p>
            </div>
            <div className="rounded-xl border border-border-subtle">
              {scoped
                .filter((entry) => entry.type !== "apply_pending")
                .map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-4 border-b border-border-subtle px-4 py-2.5 text-sm last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink-900">{typeLabel(entry.type)}</p>
                    <p className="font-mono text-xs text-ink-400">
                      {shortenAddress(entry.signature, 6)} · {formatTimestamp(entry.timestamp)}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-ink-900">
                    {formatAmount(entry.confidential?.disclosedAmount ?? entry.publicAmount ?? 0)} {MINT.symbol}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function AgentInvestigationSection() {
  const c = useCopy();
  const activity = useDemoStore((s) => s.activity);
  const decisionRecords = useDemoStore((s) => s.decisionRecords);
  const auditorKeyGenerations = useDemoStore((s) => s.auditorKeyGenerations);
  const requestAuditDisclosure = useDemoStore((s) => s.requestAuditDisclosure);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [disclosingIds, setDisclosingIds] = useState<Set<string>>(new Set());

  const agentTransfers = useMemo(
    () => activity.filter((a) => a.type === "confidential_transfer" && a.originAgentProposalId),
    [activity]
  );

  if (agentTransfers.length === 0) {
    return (
      <Card>
        <CardHeader title={c.audit.investigationTitle} subtitle={c.audit.investigationSubtitle} />
        <p className="px-5 py-6 text-center text-sm text-ink-500">{c.audit.investigationEmpty}</p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title={c.audit.investigationTitle} subtitle={c.audit.investigationSubtitle} />
      <div>
        {agentTransfers.map((entry) => {
          const record = decisionRecords.find((d) => d.agentProposalId === entry.originAgentProposalId);
          const from = findPersona(entry.fromAccountId);
          const to = findPersona(entry.toAccountId);
          const revealed = revealedIds.has(entry.id);
          const gen = auditorKeyGenerations.find((g) => g.id === entry.confidential?.auditorKeyGenerationId);

          return (
            <div key={entry.id} className="grid grid-cols-1 gap-4 border-b border-border-subtle px-5 py-5 last:border-b-0 lg:grid-cols-2">
              <div className="rounded-xl border border-border-subtle p-4">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
                  <ShieldCheck size={13} /> {c.audit.paymentEvidence}
                </p>
                <p className="text-sm font-medium text-ink-900">
                  {from?.name} → {to?.name}
                </p>
                <p className="mt-0.5 font-mono text-xs text-ink-400">
                  {shortenAddress(entry.signature, 6)} · {gen && c.audit.keyGenLabel(gen.generation)}
                </p>
                <div className="mt-3">
                  {entry.confidential?.disclosedAmount != null ? (
                    <p className="text-sm font-semibold text-ink-900">
                      {formatAmount(entry.confidential.disclosedAmount)} {MINT.symbol}
                    </p>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={disclosingIds.has(entry.id)}
                      onClick={async () => {
                        setDisclosingIds((s) => new Set(s).add(entry.id));
                        try {
                          await requestAuditDisclosure(
                            entry.id,
                            "Auditor — M. Fung",
                            "Combined investigation",
                            entry.confidential!.auditorKeyGenerationId
                          );
                        } finally {
                          setDisclosingIds((s) => {
                            const next = new Set(s);
                            next.delete(entry.id);
                            return next;
                          });
                        }
                      }}
                    >
                      {disclosingIds.has(entry.id) ? c.common.processing : c.audit.decryptAmount}
                    </Button>
                  )}
                </div>
                {record && (
                  <p className="mt-3 text-xs text-ink-500">
                    {c.audit.correlationRef} <span className="font-mono">{record.correlationRef}</span>
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-border-subtle p-4">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
                  <ScrollText size={13} /> {c.audit.decisionEvidence}
                </p>
                {!record ? (
                  <p className="flex items-center gap-1.5 text-sm text-ink-500">
                    <FileQuestion size={14} /> {c.audit.noDecisionRecord}
                  </p>
                ) : !revealed ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setRevealedIds((s) => new Set(s).add(entry.id))}
                  >
                    {c.audit.revealDecisionRecord}
                  </Button>
                ) : (
                  <div className="flex flex-col gap-1.5 text-xs text-ink-700">
                    <p><span className="text-ink-400">{c.audit.decisionInput}</span> {record.input}</p>
                    <p><span className="text-ink-400">{c.audit.decisionPolicyVersion}</span> {record.policyVersion}</p>
                    <p><span className="text-ink-400">{c.audit.decisionModelVersion}</span> {record.modelVersion}</p>
                    <p><span className="text-ink-400">{c.audit.decisionToolActions}</span> {record.toolActions.join(" → ")}</p>
                    <p>
                      <span className="text-ink-400">{c.audit.decisionApprovals}</span>{" "}
                      {record.approvals.map((a) => `${a.by} (${a.role})`).join(", ")}
                    </p>
                    <p>
                      <span className="text-ink-400">{c.audit.decisionOutcome}</span>{" "}
                      {record.outcome.failed && record.outcome.stage
                        ? c.audit.outcomeFailedAt(stageLabel(c, record.outcome.stage))
                        : c.audit.outcomeExecuted}
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="border-t border-border-subtle px-5 py-3 text-xs text-ink-400">{c.audit.investigationFooter}</p>
    </Card>
  );
}

function KeyTimeline({
  generations,
  onRotate,
}: {
  generations: { id: string; generation: number; createdAt: number; retiredAt: number | null; status: string }[];
  onRotate: () => Promise<unknown>;
}) {
  const c = useCopy();
  const [rotating, setRotating] = useState(false);

  async function handleRotate() {
    setRotating(true);
    try {
      await onRotate();
    } finally {
      setRotating(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={c.audit.keyTimelineTitle}
        subtitle={c.audit.keyTimelineSubtitle}
        action={
          <Button size="sm" variant="secondary" disabled={rotating} onClick={handleRotate}>
            <KeyRound size={14} /> {rotating ? c.common.processing : c.audit.rotateButton}
          </Button>
        }
      />
      <div className="flex flex-col gap-3 px-5 py-4">
        {generations.map((g) => (
          <div
            key={g.id}
            className={clsx(
              "flex items-center justify-between gap-4 rounded-xl border px-4 py-3 text-sm",
              g.status === "active"
                ? "border-success-100 bg-success-50"
                : "border-border-subtle bg-canvas/60"
            )}
          >
            <div>
              <p className="font-medium text-ink-900">{c.audit.keyGenLabel(g.generation)}</p>
              <p className="text-xs text-ink-500">
                {c.audit.createdLabel(formatTimestamp(g.createdAt))}
                {g.retiredAt ? ` · ${c.audit.retiredLabel(formatTimestamp(g.retiredAt))}` : ""}
              </p>
            </div>
            <PrivacyBadge variant={g.status === "active" ? "on-chain-evidence" : "demo-simulation"} />
          </div>
        ))}
        <p className="text-xs text-ink-400">{c.audit.rotationNote}</p>
      </div>
    </Card>
  );
}

function DisclosureForm({
  activityId,
  defaultKeyGenerationId,
  keyGenerations,
  onSubmit,
}: {
  activityId: string;
  defaultKeyGenerationId: string;
  keyGenerations: { id: string; generation: number }[];
  onSubmit: (requestedBy: string, reason: string, keyGenerationId: string) => Promise<unknown>;
}) {
  const c = useCopy();
  const [requestedBy, setRequestedBy] = useState("Auditor — M. Fung");
  const [reason, setReason] = useState("");
  const [keyGenerationId, setKeyGenerationId] = useState(defaultKeyGenerationId);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const disclosures = useDemoStore((s) => s.auditDisclosures);
  const latest = disclosures.find((d) => d.activityId === activityId);

  return (
    <div className="border-t border-border-subtle bg-canvas/40 px-5 py-4">
      {!submitted || !latest ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-700">
            {c.audit.requestedByLabel}
            <input
              value={requestedBy}
              onChange={(e) => setRequestedBy(e.target.value)}
              className="rounded-lg border border-border-strong px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-700">
            {c.audit.reasonLabel}
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={c.audit.reasonPlaceholder}
              className="rounded-lg border border-border-strong px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-700">
            {c.audit.keyGenerationLabel}
            <select
              value={keyGenerationId}
              onChange={(e) => setKeyGenerationId(e.target.value)}
              className="rounded-lg border border-border-strong px-3 py-2 text-sm"
            >
              {keyGenerations.map((g) => (
                <option key={g.id} value={g.id}>
                  {c.audit.keyGenLabel(g.generation)}
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            disabled={!reason.trim() || submitting}
            onClick={async () => {
              setSubmitting(true);
              try {
                await onSubmit(requestedBy, reason, keyGenerationId);
                setSubmitted(true);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? c.common.processing : c.audit.decryptButton}
          </Button>
        </div>
      ) : latest.outcome === "success" ? (
        <div className="rounded-lg border border-success-100 bg-success-50 p-3 text-sm text-success-600">
          {c.audit.decryptedAmountResult(
            `${formatAmount(latest.decryptedAmount)} ${MINT.symbol}`,
            latest.requestedBy,
            formatTimestamp(latest.timestamp)
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-danger-100 bg-danger-50 p-3 text-sm text-danger-600">
          {c.audit.wrongKeyResult}
        </div>
      )}
    </div>
  );
}
