"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { PrivacyBadge, WarningNote } from "@/components/ui/badge";
import { useDemoStore } from "@/store/demo-store";
import { findPersona, MINT, PERSONAS } from "@/lib/mock-data";
import { AgentProposal, AgentProposalStatus, DataItemKey } from "@/lib/types";
import { formatAmount } from "@/lib/format";
import { useRouter } from "next/navigation";
import {
  Bot,
  User,
  ScaleIcon,
  Wallet,
  ArrowRight,
  CircleCheck,
  CircleX,
  Clock3,
} from "lucide-react";
import { clsx } from "clsx";
import { useCopy } from "@/lib/i18n/use-copy";
import { Copy } from "@/lib/i18n";
import { stageLabel } from "@/lib/i18n/helpers";
import { SolscanLink } from "@/components/ui/solscan-link";

export default function AgentPaymentsPage() {
  const c = useCopy();
  const createAgentProposal = useDemoStore((s) => s.createAgentProposal);
  const agentProposals = useDemoStore((s) => s.agentProposals);
  const ownerAccountId = useDemoStore((s) => s.ownerAccountId);
  const ownerPersona = findPersona(ownerAccountId);

  const [intent, setIntent] = useState("");

  return (
    <>
      <PageHeader
        title={c.agent.title}
        subtitle={c.agent.subtitle}
        showWallet={false}
        actions={
          ownerPersona && (
            <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-xs">
              <Avatar initials={ownerPersona.initials} seed={ownerPersona.id} size="sm" />
              <div>
                <p className="text-ink-400">{c.agent.actingForLabel}</p>
                <p className="font-semibold text-ink-900">{ownerPersona.name}</p>
              </div>
            </div>
          )
        }
      />

      <main className="flex flex-col gap-5 px-6 py-6">
        <DeploymentFlowCard />

        <Card>
          <CardHeader title={c.agent.newInstructionTitle} subtitle={c.agent.newInstructionSubtitle} />
          <div className="flex flex-col gap-3 px-5 py-5">
            <textarea
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              rows={3}
              placeholder={c.agent.instructionPlaceholder}
              className="rounded-lg border border-border-strong px-3 py-2.5 text-sm text-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
            />
            <div>
              <Button
                disabled={!intent.trim()}
                onClick={() => {
                  createAgentProposal(intent);
                  setIntent("");
                }}
              >
                <Bot size={16} /> {c.agent.proposeButton}
              </Button>
            </div>
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          {agentProposals.length === 0 && (
            <p className="rounded-xl border border-dashed border-border-strong px-5 py-8 text-center text-sm text-ink-500">
              {c.agent.emptyState}
            </p>
          )}
          {agentProposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} />
          ))}
        </div>
      </main>
    </>
  );
}

function DeploymentFlowCard() {
  const c = useCopy();
  const stages = [
    { label: c.agent.stageCustomerIntent, icon: User },
    { label: c.agent.stageBankAgent, icon: Bot },
    { label: c.agent.stageBankPolicy, icon: ScaleIcon },
    { label: c.agent.stageUnsignedTx, icon: ArrowRight },
    { label: c.agent.stageWalletApproval, icon: Wallet },
    { label: c.agent.stageDevnet, icon: CircleCheck },
  ];
  return (
    <Card>
      <CardHeader
        title={c.agent.deploymentTitle}
        subtitle={c.agent.deploymentSubtitle}
        action={<PrivacyBadge variant="demo-simulation" />}
      />
      <div className="flex flex-wrap items-center gap-2 px-5 py-5">
        {stages.map((s, i) => (
          <div key={s.label} className="flex items-center gap-2">
            <div className="flex flex-col items-center gap-1.5 rounded-xl border border-border-subtle bg-canvas/60 px-3 py-3 text-center">
              <s.icon size={18} className="text-ink-500" />
              <span className="max-w-24 text-xs font-medium text-ink-700">{s.label}</span>
            </div>
            {i < stages.length - 1 && <ArrowRight size={14} className="text-ink-400" />}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 border-t border-border-subtle px-5 py-4 text-xs text-ink-500">
        <p>{c.agent.deploymentNote1}</p>
        <p>{c.agent.deploymentNote2}</p>
      </div>
    </Card>
  );
}

function dataItemLabel(c: Copy, key: DataItemKey): string {
  return c.dataItems[key];
}

function ProposalCard({ proposal }: { proposal: AgentProposal }) {
  const c = useCopy();
  const router = useRouter();
  const updateAmount = useDemoStore((s) => s.updateAgentProposalAmount);
  const updateRecipient = useDemoStore((s) => s.updateAgentProposalRecipient);
  const runPolicyChecks = useDemoStore((s) => s.runPolicyChecks);
  const approveAgentProposal = useDemoStore((s) => s.approveAgentProposal);
  const rejectAgentProposal = useDemoStore((s) => s.rejectAgentProposal);
  const activity = useDemoStore((s) => s.activity);

  const [amountDraft, setAmountDraft] = useState(proposal.parsed.amount?.toString() ?? "");
  const [signing, setSigning] = useState(false);

  const recipient = proposal.parsed.recipientAccountId
    ? findPersona(proposal.parsed.recipientAccountId)
    : null;

  const resultEntry = proposal.resultingActivityId
    ? activity.find((a) => a.id === proposal.resultingActivityId)
    : undefined;

  async function approve() {
    setSigning(true);
    try {
      await approveAgentProposal(proposal.id);
    } finally {
      setSigning(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={`"${proposal.naturalLanguageIntent}"`}
        subtitle={c.agent.proposalSubtitle}
        action={<ProposalStatusBadge status={proposal.status} />}
      />
      <div className="flex flex-col gap-4 px-5 py-5">
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-border-subtle p-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-ink-500">{c.agent.recipientLabel}</p>
            {recipient ? (
              <p className="font-medium text-ink-900">{recipient.name}</p>
            ) : (
              <select
                className="mt-1 rounded-md border border-border-strong px-2 py-1 text-xs"
                onChange={(e) => updateRecipient(proposal.id, e.target.value)}
                defaultValue=""
              >
                <option value="" disabled>
                  {c.agent.selectPlaceholder}
                </option>
                {PERSONAS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <p className="text-ink-500">{c.agent.assetLabel}</p>
            <p className="font-medium text-ink-900">{proposal.parsed.asset}</p>
          </div>
          <div>
            <p className="text-ink-500">{c.agent.amountLabel}</p>
            {proposal.parsed.amount != null ? (
              <p className="font-medium text-ink-900">
                {formatAmount(proposal.parsed.amount)} {MINT.symbol}
              </p>
            ) : (
              <div className="mt-1 flex gap-1">
                <input
                  value={amountDraft}
                  onChange={(e) => setAmountDraft(e.target.value)}
                  className="w-20 rounded-md border border-border-strong px-2 py-1 text-xs"
                  placeholder="0.00"
                />
                <Button size="sm" onClick={() => updateAmount(proposal.id, parseFloat(amountDraft) || 0)}>
                  {c.agent.setButton}
                </Button>
              </div>
            )}
          </div>
          <div>
            <p className="text-ink-500">{c.agent.timingLabel}</p>
            <p className="font-medium text-ink-900">
              {proposal.parsed.timing === "immediate" ? c.agent.timing.immediate : c.agent.timing.scheduledTomorrow}
            </p>
          </div>
        </div>

        {proposal.parsed.ambiguous && proposal.parsed.ambiguityKey && (
          <WarningNote>{c.agent.ambiguity[proposal.parsed.ambiguityKey]}</WarningNote>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(
            [
              ["agent", proposal.dataGivenToComponents.agent, c.agent.dataComponentAgent],
              ["policyService", proposal.dataGivenToComponents.policyService, c.agent.dataComponentPolicyService],
              ["signer", proposal.dataGivenToComponents.signer, c.agent.dataComponentSigner],
            ] as const
          ).map(([component, items, componentLabel]) => (
            <div key={component} className="rounded-xl border border-border-subtle p-3 text-xs">
              <p className="mb-1 font-semibold uppercase tracking-wide text-ink-400">
                {c.agent.dataGivenTo(componentLabel)}
              </p>
              <ul className="flex flex-col gap-0.5 text-ink-600">
                {items.map((it) => (
                  <li key={it}>· {dataItemLabel(c, it)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {proposal.status === "policy_review" && !proposal.parsed.ambiguous && (
          <div>
            <Button variant="secondary" onClick={() => runPolicyChecks(proposal.id)}>
              {c.agent.runPolicyChecks}
            </Button>
          </div>
        )}

        {proposal.policyChecks.length > 0 && (
          <div className="rounded-xl border border-border-subtle">
            {proposal.policyChecks.map((check) => (
              <div
                key={check.key}
                className="flex items-center gap-3 border-b border-border-subtle px-4 py-2.5 text-sm last:border-b-0"
              >
                {check.status === "pass" && <CircleCheck size={15} className="shrink-0 text-success-500" />}
                {check.status === "fail" && <CircleX size={15} className="shrink-0 text-danger-500" />}
                {check.status === "requires_approval" && (
                  <Clock3 size={15} className="shrink-0 text-warning-500" />
                )}
                <span className="font-medium text-ink-900">{c.policy[check.key].name}</span>
                <span className="ml-auto text-xs text-ink-500">
                  {check.key === "dailyLimit"
                    ? c.policy.dailyLimit.detail(check.dailyLimitValue ?? "")
                    : check.key === "humanApproval"
                    ? c.policy.humanApproval.detail
                    : check.status === "pass"
                    ? c.policy[check.key].pass
                    : c.policy[check.key].fail}
                </span>
              </div>
            ))}
          </div>
        )}

        {proposal.status === "awaiting_approval" && (
          <div className="flex flex-col gap-3 rounded-xl border border-warning-100 bg-warning-50 p-4">
            <p className="text-sm text-warning-600">{c.agent.humanApprovalNote}</p>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => rejectAgentProposal(proposal.id)}>
                {c.agent.reject}
              </Button>
              <Button disabled={signing} onClick={approve}>
                {signing ? c.agent.approving : c.agent.approve}
              </Button>
            </div>
          </div>
        )}

        {(proposal.status === "executed" || proposal.status === "failed") && (
          <div
            className={clsx(
              "rounded-xl border p-4 text-sm",
              proposal.status === "executed"
                ? "border-success-100 bg-success-50 text-success-600"
                : "border-danger-100 bg-danger-50 text-danger-600"
            )}
          >
            <p className="font-medium">
              {proposal.status === "executed" ? c.agent.executedTitle : c.agent.failedTitle}
            </p>
            {proposal.status === "failed" && proposal.failureStage && (
              <p className="mt-1">
                {c.agent.failedAtStage(stageLabel(c, proposal.failureStage))}
                {proposal.failureReason ? ` — ${proposal.failureReason}` : ""}
              </p>
            )}
            <div className="mt-2 flex items-center gap-3">
              <SolscanLink size="sm" signature={resultEntry?.signature} />
              <Button size="sm" variant="secondary" onClick={() => router.push("/audit")}>
                {c.agent.openInvestigation}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function ProposalStatusBadge({ status }: { status: AgentProposalStatus }) {
  const c = useCopy();
  const color =
    status === "executed"
      ? "bg-success-50 text-success-600 border-success-100"
      : status === "failed" || status === "rejected"
      ? "bg-danger-50 text-danger-600 border-danger-100"
      : status === "needs_clarification"
      ? "bg-warning-50 text-warning-600 border-warning-100"
      : "bg-ink-900/5 text-ink-700 border-transparent";

  const label = {
    parsing: c.agent.status.parsing,
    needs_clarification: c.agent.status.needsClarification,
    policy_review: c.agent.status.policyReview,
    awaiting_approval: c.agent.status.awaitingApproval,
    approved: c.agent.status.approved,
    rejected: c.agent.status.rejected,
    executing: c.agent.status.executing,
    executed: c.agent.status.executed,
    failed: c.agent.status.failed,
  }[status];

  return (
    <span className={clsx("rounded-full border px-2.5 py-1 text-xs font-medium", color)}>{label}</span>
  );
}
