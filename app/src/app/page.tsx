"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PrivacyBadge } from "@/components/ui/badge";
import { ActivityList } from "@/components/activity/activity-list";
import { MintSupplyDrawer } from "@/components/flows/mint-supply-drawer";
import { SolscanIconLink } from "@/components/ui/solscan-link";
import { CopyButton } from "@/components/ui/copy-button";
import { useDemoStore } from "@/store/demo-store";
import { PERSONAS, MINT } from "@/lib/mock-data";
import { formatAmount, shortenAddress } from "@/lib/format";
import { Coins } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCopy } from "@/lib/i18n/use-copy";

// The Console never grants owner authority — it's a permanent public-observer
// overview across every account. Becoming an account's owner only happens by
// selecting it in the sidebar, which lands on that account's own detail page.
const CONSOLE_ROLE = "public" as const;

export default function DashboardPage() {
  const c = useCopy();
  const router = useRouter();
  const balances = useDemoStore((s) => s.balances);
  const activity = useDemoStore((s) => s.activity);
  const totalSupply = useDemoStore((s) => s.totalSupply);
  const auditorKeyGenerations = useDemoStore((s) => s.auditorKeyGenerations);
  const [mintOpen, setMintOpen] = useState(false);

  const recentActivity = useMemo(() => activity.slice(0, 6), [activity]);
  const activeAuditorKey = auditorKeyGenerations.find((g) => g.status === "active");

  return (
    <>
      <PageHeader
        title={c.dashboard.title}
        subtitle={c.dashboard.subtitle}
        showWallet={false}
        infoTooltip={`${c.dashboard.thirdPartyQueryNote} ${c.dashboard.ownerAccessHint}`}
      />

      <main className="flex flex-col gap-5 px-6 py-6">
        <Card>
          <CardHeader
            title={c.mint.configTitle}
            subtitle={c.mint.configSubtitle}
            action={
              <Button size="sm" onClick={() => setMintOpen(true)}>
                <Coins size={14} /> {c.mint.mintActionButton}
              </Button>
            }
          />
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 px-5 py-4 text-sm sm:grid-cols-2">
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-ink-500">{c.mint.mintAddressLabel}</p>
                <p className="flex items-center gap-1 font-mono text-sm text-ink-900">
                  {shortenAddress(MINT.address)}
                  <SolscanIconLink address={MINT.address} />
                </p>
              </div>
              <div>
                <p className="text-ink-500">{c.mint.assetLabel}</p>
                <p className="font-medium text-ink-900">
                  {MINT.symbol} / {MINT.decimals}
                </p>
              </div>
              <div>
                <p className="text-ink-500">{c.mint.extensionsLabel}</p>
                <p className="font-medium text-ink-900">{MINT.extensions.join(", ")}</p>
              </div>
              <div>
                <p className="text-ink-500">{c.mint.authorityLabel}</p>
                <p className="font-mono text-sm text-ink-900">
                  {shortenAddress(MINT.confidentialTransferAuthority)}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-ink-500">{c.mint.supplyLabel}</p>
                <p className="font-medium text-ink-900">
                  {formatAmount(totalSupply)} {MINT.symbol}
                </p>
              </div>
              <div>
                <p className="text-ink-500">{c.mint.programLabel}</p>
                <p className="font-mono text-sm text-ink-900">{shortenAddress(MINT.programId)}</p>
              </div>
              <div>
                <p className="text-ink-500">{c.mint.autoApproveLabel}</p>
                <p className="font-medium text-ink-900">
                  {MINT.autoApproveNewAccounts ? c.mint.enabled : c.mint.disabled}
                </p>
              </div>
              {activeAuditorKey && (
                <div>
                  <p className="text-ink-500">{c.mint.auditorPubkeyLabel}</p>
                  <p className="font-mono text-sm text-ink-900">
                    {c.audit.keyGenLabel(activeAuditorKey.generation)} ·{" "}
                    {shortenAddress(activeAuditorKey.elgamalPubkey)}
                  </p>
                </div>
              )}
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          <Card className="xl:col-span-2">
            <CardHeader title={c.dashboard.accountsPanelTitle} subtitle={c.dashboard.accountsPanelSubtitle} />
            <div>
              {PERSONAS.map((p) => {
                const pb = balances[p.id];
                return (
                  <div
                    key={p.id}
                    className="flex w-full items-center gap-3 border-b border-border-subtle px-5 py-4 last:border-b-0 hover:bg-canvas/60"
                  >
                    <button
                      onClick={() => router.push(`/accounts/${p.id}`)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <Avatar initials={p.initials} seed={p.id} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink-900">{p.name}</p>
                        <p className="truncate font-mono text-xs text-ink-400">
                          {shortenAddress(p.address)}
                        </p>
                      </div>
                    </button>
                    <CopyButton value={p.address} />
                    <button
                      onClick={() => router.push(`/accounts/${p.id}`)}
                      className="shrink-0 text-right"
                    >
                      <p className="text-sm font-semibold text-ink-900">
                        {formatAmount(pb.publicBalance)} {MINT.symbol}
                      </p>
                      <PrivacyBadge variant="encrypted" />
                    </button>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="xl:col-span-3">
            <CardHeader title={c.dashboard.recentActivityTitle} subtitle={c.dashboard.recentActivitySubtitle} />
            <ActivityList entries={recentActivity} role={CONSOLE_ROLE} ownerAccountId="" />
          </Card>
        </div>
      </main>

      <MintSupplyDrawer open={mintOpen} onClose={() => setMintOpen(false)} />
    </>
  );
}
