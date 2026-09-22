"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PrivacyBadge } from "@/components/ui/badge";
import { CiphertextChip } from "@/components/ui/ciphertext-chip";
import { SolscanIconLink } from "@/components/ui/solscan-link";
import { EvidenceSteps } from "@/components/ui/evidence-steps";
import { PasswordPrompt } from "@/components/ui/password-prompt";
import { useDemoStore } from "@/store/demo-store";
import { findPersona, MINT, PERSONAS } from "@/lib/mock-data";
import { formatAmount, formatTimestamp, shortenAddress } from "@/lib/format";
import { usePagination } from "@/lib/use-pagination";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { clsx } from "clsx";
import {
  Lock,
  KeyRound,
  ShieldCheck,
  History,
  // ScrollText, // Agent payment investigations (disabled)
  // FileQuestion, // Agent payment investigations (disabled)
} from "lucide-react";
import { useCopy } from "@/lib/i18n/use-copy";
// Agent payment investigations (disabled) — only used by the commented-out section below.
// import { Copy } from "@/lib/i18n";
// import { DecisionRecord } from "@/lib/types";
// import { policyCheckName, stageLabel } from "@/lib/i18n/helpers";

export default function AuditConsolePage() {
  const c = useCopy();
  const activity = useDemoStore((s) => s.activity);
  const auditorKeyGenerations = useDemoStore((s) => s.auditorKeyGenerations);
  const auditDisclosures = useDemoStore((s) => s.auditDisclosures);
  const requestAuditDisclosure = useDemoStore((s) => s.requestAuditDisclosure);
  const rotateAuditorKey = useDemoStore((s) => s.rotateAuditorKey);
  const authTokens = useDemoStore((s) => s.authTokens);
  const login = useDemoStore((s) => s.login);
  const logout = useDemoStore((s) => s.logout);

  const unlocked = Boolean(authTokens.auditor);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const confidentialTransfers = useMemo(
    () => activity.filter((a) => a.type === "confidential_transfer"),
    [activity]
  );
  const transfersPage = usePagination(confidentialTransfers);

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
  const accessLogPage = usePagination(operationalLog);

  return (
    <>
      <PageHeader
        title={c.audit.title}
        subtitle={c.audit.subtitle}
        showWallet={false}
        actions={
          unlocked ? (
            <Button variant="secondary" onClick={() => logout("auditor")}>
              <Lock size={16} />
              {c.audit.lockButton}
            </Button>
          ) : undefined
        }
      />

      <main className="flex flex-col gap-5 px-6 py-6">
        {!unlocked && (
          <PasswordPrompt
            title={c.audit.unlockPromptTitle}
            body={c.audit.unlockPromptBody}
            onSubmit={(password) => login("auditor", password)}
          />
        )}

        <KeyTimeline
          generations={auditorKeyGenerations}
          unlocked={unlocked}
          onRotate={rotateAuditorKey}
        />

        <Card>
          <CardHeader
            title={c.audit.transfersTitle}
            subtitle={unlocked ? c.audit.transfersSubtitleUnlocked : c.audit.transfersSubtitleLocked}
          />
          <div>
            {transfersPage.paged.map((entry) => {
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
          {transfersPage.showControls && (
            <PaginationControls
              page={transfersPage.page}
              pageCount={transfersPage.pageCount}
              hasPrev={transfersPage.hasPrev}
              hasNext={transfersPage.hasNext}
              onPrev={transfersPage.prev}
              onNext={transfersPage.next}
            />
          )}
        </Card>

        <FullHistoryReconstruction unlocked={unlocked} />

        {/* Agent payment investigations (disabled for client-facing demos)
        <AgentInvestigationSection unlocked={unlocked} />
        */}

        <Card>
          <CardHeader title={c.audit.accessRecordTitle} subtitle={c.audit.accessRecordSubtitle} />
          <div className="flex flex-col gap-0">
            {operationalLog.length === 0 && (
              <p className="px-5 py-6 text-center text-sm text-ink-500">{c.audit.accessRecordEmpty}</p>
            )}
            {accessLogPage.paged.map((event) => (
              <div key={event.id} className="flex items-start gap-3 border-b border-border-subtle px-5 py-3 text-sm last:border-b-0">
                <History size={14} className="mt-0.5 shrink-0 text-ink-400" />
                <p className="text-ink-700">{event.text}</p>
                <span className="ml-auto shrink-0 text-xs text-ink-400">
                  {formatTimestamp(event.timestamp)}
                </span>
              </div>
            ))}
          </div>
          {accessLogPage.showControls && (
            <PaginationControls
              page={accessLogPage.page}
              pageCount={accessLogPage.pageCount}
              hasPrev={accessLogPage.hasPrev}
              hasNext={accessLogPage.hasNext}
              onPrev={accessLogPage.prev}
              onNext={accessLogPage.next}
            />
          )}
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
  // Locking clears the reconstruction outright rather than only hiding it, so
  // re-unlocking can't silently restore a previous result. Reaching it again
  // means running the disclosures again — each one individually logged, which
  // is the point the panel is making.
  //
  // Done during render (React's "adjust state when a prop changes" pattern)
  // rather than in an effect: an effect would first paint the stale result
  // and then re-render to clear it, which is exactly the cascading-render
  // hazard the hooks lint rule flags.
  const [prevUnlocked, setPrevUnlocked] = useState(unlocked);
  if (unlocked !== prevUnlocked) {
    setPrevUnlocked(unlocked);
    if (!unlocked) {
      setReconstructedFor(null);
      setProgress(null);
    }
  }

  const reconstructedEntries = useMemo(
    () => scoped.filter((entry) => entry.type !== "apply_pending"),
    [scoped]
  );
  const reconstructedPage = usePagination(reconstructedEntries);

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

        {/* Derived from `unlocked`, not just from local state: this block is
            the product of auditor-authorized disclosures, so re-locking the
            console has to take it away rather than leave the reconstructed
            history (and its conclusion) on screen. */}
        {unlocked && reconstructedFor === accountId && (
          <div className="flex flex-col gap-3">
            <div className="rounded-xl border border-success-100 bg-success-50 p-4 text-sm text-success-600">
              <p className="font-medium">{c.audit.fullHistoryResultTitle}</p>
              <p className="mt-1 text-success-600/90">
                {c.audit.fullHistoryResultNote(totalConfidentialTransfers)}
              </p>
            </div>
            <div className="rounded-xl border border-border-subtle">
              {reconstructedPage.paged.map((entry) => (
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
                  {entry.confidential && entry.confidential.disclosedAmount == null ? (
                    // Undisclosed (e.g. its key generation is no longer
                    // retained) — falling back to 0.00 would state a figure
                    // for something that was never actually revealed.
                    <p className="flex shrink-0 items-center gap-1 text-sm font-medium text-ink-400">
                      <Lock size={12} /> {c.common.encrypted}
                    </p>
                  ) : (
                    <p className="shrink-0 text-sm font-semibold text-ink-900">
                      {formatAmount(entry.confidential?.disclosedAmount ?? entry.publicAmount ?? 0)}{" "}
                      {MINT.symbol}
                    </p>
                  )}
                </div>
              ))}
              {reconstructedPage.showControls && (
                <PaginationControls
                  page={reconstructedPage.page}
                  pageCount={reconstructedPage.pageCount}
                  hasPrev={reconstructedPage.hasPrev}
                  hasNext={reconstructedPage.hasNext}
                  onPrev={reconstructedPage.prev}
                  onNext={reconstructedPage.next}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// How a decision ended, in one place. The previous inline version asked
// `failed && stage ? "failed at X" : "executed"`, so every outcome that failed
// *without* a pipeline stage — withdrawn, declined — fell through the else and
// reported itself as Executed. Success is the last branch here, reached only
// when nothing else claimed the outcome, never as a fallback.
// Agent Payments is disabled for client-facing demos (not reusable). Kept commented out rather than deleted.
// Only used by AgentInvestigationSection below.
// function decisionOutcomeLabel(c: Copy, record: DecisionRecord): string {
//   if (record.blockedByPolicyChecks?.length) return c.audit.outcomeBlockedShort;
//   if (record.declinedByOperator) return c.audit.outcomeDeclinedShort;
//   if (record.abandoned) return c.audit.outcomeWithdrawnShort;
//   // `policy_checks` deliberately isn't reached here — it's claimed above, and
//   // stageLabel would render it as the proof step.
//   if (record.outcome.stage) return c.audit.outcomeFailedAt(stageLabel(c, record.outcome.stage));
//   if (record.outcome.failed) return c.audit.outcomeNotExecuted;
//   return c.audit.outcomeExecuted;
// }
//
// function AgentInvestigationSection({ unlocked }: { unlocked: boolean }) {
//   const c = useCopy();
//   const activity = useDemoStore((s) => s.activity);
//   const decisionRecords = useDemoStore((s) => s.decisionRecords);
//   const auditorKeyGenerations = useDemoStore((s) => s.auditorKeyGenerations);
//   const requestAuditDisclosure = useDemoStore((s) => s.requestAuditDisclosure);
//   const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
//   const [disclosingIds, setDisclosingIds] = useState<Set<string>>(new Set());
//
//   // A case is either side of the pair, joined where both exist — because the
//   // two sources have opposite blind spots. A *failed* payment never reaches
//   // the chain, so it has no activity entry and exists only as a decision
//   // record; keying off activity alone would hide exactly what the Agent
//   // Payments page sends an auditor here to investigate. But decision records
//   // are client-side state that a page reload clears, while the activity entry
//   // behind an *executed* payment is persisted server-side; keying off
//   // decision records alone would make successful payments vanish on refresh.
//   const agentCases = useMemo(() => {
//     const fromRecords = decisionRecords.map((record) => ({
//       key: record.id,
//       record,
//       entry:
//         activity.find(
//           (a) =>
//             a.type === "confidential_transfer" &&
//             a.originAgentProposalId === record.agentProposalId
//         ) ?? null,
//     }));
//     const covered = new Set(decisionRecords.map((r) => r.agentProposalId));
//     const orphanedTransfers = activity
//       .filter(
//         (a) =>
//           a.type === "confidential_transfer" &&
//           a.originAgentProposalId &&
//           !covered.has(a.originAgentProposalId)
//       )
//       .map((entry) => ({ key: entry.id, record: null, entry }));
//     return [...fromRecords, ...orphanedTransfers];
//   }, [decisionRecords, activity]);
//   // Two per page: each case is a tall two-panel card (payment evidence
//   // beside decision evidence), so more than a pair at once buries the
//   // sections below it.
//   const agentPage = usePagination(agentCases, 2);
//
//   if (agentCases.length === 0) {
//     return (
//       <Card>
//         <CardHeader title={c.audit.investigationTitle} subtitle={c.audit.investigationSubtitle} />
//         <p className="px-5 py-6 text-center text-sm text-ink-500">{c.audit.investigationEmpty}</p>
//       </Card>
//     );
//   }
//
//   return (
//     <Card>
//       <CardHeader
//         title={c.audit.investigationTitle}
//         subtitle={unlocked ? c.audit.investigationSubtitle : c.audit.investigationSubtitleLocked}
//       />
//       <div>
//         {agentPage.paged.map(({ key, record, entry }) => {
//           // At least one side is always present; prefer the record's own
//           // copy of who paid whom, since it survives when the transfer doesn't.
//           const from = findPersona(record?.fromAccountId ?? entry!.fromAccountId);
//           const to = findPersona(record?.toAccountId ?? entry!.toAccountId);
//           // Derived rather than read straight from state: re-locking the
//           // console has to hide a record that was revealed a moment ago,
//           // not leave it sitting there until something else re-renders.
//           const revealed = unlocked && revealedIds.has(key);
//           const gen = auditorKeyGenerations.find((g) => g.id === entry?.confidential?.auditorKeyGenerationId);
//
//           return (
//             <div key={key} className="grid grid-cols-1 gap-4 border-b border-border-subtle px-5 py-5 last:border-b-0 lg:grid-cols-2">
//               <div className="rounded-xl border border-border-subtle p-4">
//                 <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
//                   <ShieldCheck size={13} /> {c.audit.paymentEvidence}
//                 </p>
//                 <p className="text-sm font-medium text-ink-900">
//                   {/* An abandoned instruction may never have resolved one. */}
//                   {from?.name} → {to?.name ?? c.audit.recipientUnresolved}
//                 </p>
//                 {entry ? (
//                   <p className="mt-0.5 font-mono text-xs text-ink-400">
//                     {shortenAddress(entry.signature, 6)} · {gen && c.audit.keyGenLabel(gen.generation)}
//                   </p>
//                 ) : (
//                   // Nothing was submitted, so there is no signature, no
//                   // ciphertext and nothing an auditor could disclose — the
//                   // evidence here is that the payment never happened.
//                   <p className="mt-0.5 text-xs text-ink-500">{c.audit.noTransactionOnChain}</p>
//                 )}
//                 <div className="mt-3">
//                   {!entry ? (
//                     <p className="text-sm font-medium text-danger-600">
//                       {record?.blockedByPolicyChecks?.length ? (
//                         // Its own verdict rather than the generic failure-stage
//                         // line: this never got as far as a stage, and naming
//                         // the checks is the whole substance of the record.
//                         c.audit.blockedByPolicy(
//                           record.blockedByPolicyChecks
//                             .map((key) => policyCheckName(c, key))
//                             .join(", ")
//                         )
//                       ) : record?.declinedByOperator ? (
//                         c.audit.declinedByOperator(record.declinedByOperator.by)
//                       ) : record?.abandoned ? (
//                         // Attributed to the customer whose instruction it was,
//                         // not to a person the demo can't identify.
//                         c.audit.abandonedBeforeReview(from?.name ?? "")
//                       ) : record?.outcome.stage ? (
//                         c.audit.outcomeFailedAt(stageLabel(c, record.outcome.stage))
//                       ) : (
//                         c.audit.outcomeNotExecuted
//                       )}
//                     </p>
//                   ) : entry.confidential?.disclosedAmount != null ? (
//                     <p className="text-sm font-semibold text-ink-900">
//                       {formatAmount(entry.confidential.disclosedAmount)} {MINT.symbol}
//                     </p>
//                   ) : (
//                     <Button
//                       size="sm"
//                       variant="secondary"
//                       disabled={!unlocked || disclosingIds.has(entry.id)}
//                       onClick={async () => {
//                         setDisclosingIds((s) => new Set(s).add(entry.id));
//                         try {
//                           await requestAuditDisclosure(
//                             entry.id,
//                             "Auditor — M. Fung",
//                             "Combined investigation",
//                             entry.confidential!.auditorKeyGenerationId
//                           );
//                         } finally {
//                           setDisclosingIds((s) => {
//                             const next = new Set(s);
//                             next.delete(entry.id);
//                             return next;
//                           });
//                         }
//                       }}
//                     >
//                       {disclosingIds.has(entry.id) ? c.common.processing : c.audit.decryptAmount}
//                     </Button>
//                   )}
//                 </div>
//                 {record && (
//                   <p className="mt-3 text-xs text-ink-500">
//                     {c.audit.correlationRef} <span className="font-mono">{record.correlationRef}</span>
//                   </p>
//                 )}
//               </div>
//
//               <div className="rounded-xl border border-border-subtle p-4">
//                 <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
//                   <ScrollText size={13} /> {c.audit.decisionEvidence}
//                 </p>
//                 {!record ? (
//                   <p className="flex items-center gap-1.5 text-sm text-ink-500">
//                     <FileQuestion size={14} /> {c.audit.noDecisionRecord}
//                   </p>
//                 ) : !revealed ? (
//                   <Button
//                     size="sm"
//                     variant="secondary"
//                     disabled={!unlocked}
//                     onClick={() => setRevealedIds((s) => new Set(s).add(key))}
//                   >
//                     {c.audit.revealDecisionRecord}
//                   </Button>
//                 ) : (
//                   <div className="flex flex-col gap-1.5 text-xs text-ink-700">
//                     <p><span className="text-ink-400">{c.audit.decisionInput}</span> {record.input}</p>
//                     <p><span className="text-ink-400">{c.audit.decisionPolicyVersion}</span> {record.policyVersion}</p>
//                     <p><span className="text-ink-400">{c.audit.decisionModelVersion}</span> {record.modelVersion}</p>
//                     <p><span className="text-ink-400">{c.audit.decisionToolActions}</span> {record.toolActions.join(" → ")}</p>
//                     <p>
//                       <span className="text-ink-400">{c.audit.decisionApprovals}</span>{" "}
//                       {record.approvals.map((a) => `${a.by} (${a.role})`).join(", ")}
//                     </p>
//                     <p>
//                       <span className="text-ink-400">{c.audit.decisionOutcome}</span>{" "}
//                       {decisionOutcomeLabel(c, record)}
//                     </p>
//                   </div>
//                 )}
//               </div>
//             </div>
//           );
//         })}
//       </div>
//       {agentPage.showControls && (
//         <PaginationControls
//           page={agentPage.page}
//           pageCount={agentPage.pageCount}
//           hasPrev={agentPage.hasPrev}
//           hasNext={agentPage.hasNext}
//           onPrev={agentPage.prev}
//           onNext={agentPage.next}
//         />
//       )}
//       <p className="border-t border-border-subtle px-5 py-3 text-xs text-ink-400">{c.audit.investigationFooter}</p>
//     </Card>
//   );
// }

function KeyTimeline({
  generations,
  unlocked,
  onRotate,
}: {
  generations: { id: string; generation: number; createdAt: number; retiredAt: number | null; status: string }[];
  unlocked: boolean;
  onRotate: (confirmPassword: string) => Promise<unknown>;
}) {
  const c = useCopy();
  const [showConfirm, setShowConfirm] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState(false);

  const requiredPhrase = c.audit.rotateConfirmPhrasePlaceholder;
  const phraseMatches = phrase.trim() === requiredPhrase;

  async function handleRotate() {
    setRotating(true);
    setError(false);
    try {
      await onRotate(password);
      setShowConfirm(false);
      setPhrase("");
      setPassword("");
    } catch {
      setError(true);
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
          <Button
            size="sm"
            variant="secondary"
            disabled={!unlocked}
            onClick={() => setShowConfirm((v) => !v)}
          >
            <KeyRound size={14} /> {c.audit.rotateButton}
          </Button>
        }
      />
      {showConfirm && (
        <div className="flex flex-col gap-3 border-b border-border-subtle bg-canvas/60 px-5 py-4">
          <p className="text-sm font-medium text-ink-900">{c.audit.rotateConfirmTitle}</p>
          <p className="text-xs text-ink-500">{c.audit.rotateConfirmBody}</p>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-700">
            {c.audit.rotateConfirmPhraseLabel(requiredPhrase)}
            <input
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder={requiredPhrase}
              className="rounded-lg border border-border-strong px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-700">
            {c.audit.rotateConfirmPasswordLabel}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-border-strong px-3 py-2 text-sm"
            />
          </label>
          {phrase.length > 0 && !phraseMatches && (
            <p className="text-xs text-danger-600">{c.audit.rotateConfirmPhraseMismatch}</p>
          )}
          {error && <p className="text-xs text-danger-600">{c.common.wrongPassword}</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setShowConfirm(false)}>
              {c.common.cancel}
            </Button>
            <Button size="sm" disabled={!phraseMatches || !password || rotating} onClick={handleRotate}>
              {rotating ? c.common.processing : c.audit.rotateConfirmButton}
            </Button>
          </div>
        </div>
      )}
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
