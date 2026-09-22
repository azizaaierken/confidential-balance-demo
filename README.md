# Confidential Balance Demo

A reference demo of Solana Token-2022 **Confidential Transfers** for a
bank-style operations console: a single Bun + SvelteKit app that mints,
deposits, transfers, applies pending balances, withdraws, and handles
per-transfer auditor disclosure and auditor-key rotation on **Solana devnet**.

> **Devnet only. Demo keys. Not production code.** Every signing key (payer,
> mint authority, both personas, the auditor root) is a plain keypair held by
> the server, standing in for wallets, HSMs and an auditor's key custody. The
> point of the demo is the protocol flow and what each party can and cannot
> see, not the key management around it.

## What it shows

- **Confidential balances** on a Token-2022 mint with the
  `ConfidentialTransferMint` extension: public, pending and available
  balance states, and why pending funds must be applied before they spend.
- **A confidential transfer** as one V1 (SIMD-0385) transaction carrying the
  equality, ciphertext-validity and range proofs inline — three ZK ElGamal
  Proof program instructions followed by the Token-2022 transfer, no
  context-state accounts — with the exact transaction simulated on devnet
  before it is signed.
- **Deposits, withdrawals and minting** as public movements, labelled as such.
  Withdraw is also a single V1 transaction with its two proofs inline.
- **Per-transfer auditor disclosure**: the auditor's ElGamal ciphertext of
  each transfer amount is captured at transfer time (Token-2022 does not
  persist it) and can be decrypted later with the matching auditor key
  generation, one transfer at a time. Decryption with the wrong generation
  fails safely.
- **Auditor key rotation**, with retired generations kept so historical
  transfers stay disclosable.
- **Role-based visibility** enforced server-side: the viewer switches on the
  sender's owner view, the receiver's, the auditor's, or any combination,
  and the server redacts everything that combination is not entitled to
  see. The switches are the demo's stand-in for wallets and an authenticated
  auditor session — see *Roles and visibility* below.

## Structure

Everything lives in [`console/`](./console), a SvelteKit 2 + Svelte 5 (runes)
app that runs on Bun:

- `src/lib/server/` — the server side: key derivation, RPC client, the
  Token-2022 confidential-transfer operations (`ops/`), the role model, the
  redacting state reader and the Postgres/memory store. Built on
  `@solana/kit`, `@solana/zk-sdk`, `@solana-program/token-2022` and
  `@solana-program/zk-elgamal-proof`.
- `src/routes/api/` — the JSON API the UI calls (`state`, `mint`, `deposit`,
  `apply-pending`, `withdraw`, `transfer`, `transfer/simulate`,
  `auditor/rotate`, `auditor/disclose`).
- `src/routes/` and `src/lib/components/` — the console UI (dashboard,
  per-account view, audit console; English, Simplified and Traditional
  Chinese).
- `scripts/bootstrap.ts` and `scripts/spike.ts` — local devnet setup and the
  end-to-end round trip.

## Running locally

```bash
cd console
bun install
bun run bootstrap   # one-shot: generates keys into .env, funds the payer,
                    # creates the confidential mint, configures both personas'
                    # token accounts. Safe to re-run.
bun run dev         # http://localhost:5173
```

Bootstrap writes every keypair and the mint address to `console/.env`
(gitignored; see [`console/.env.example`](./console/.env.example) for the
variable names). Delete that file to start over with a fresh mint and fresh
personas — and note that a fresh mint means a fresh set of keys, so do not
re-run bootstrap against an `.env` you still want.

Bootstrap tries to airdrop devnet SOL to the payer, but the public faucet is
rate-limited and frequently refuses. If it fails, fund the payer address it
prints from any wallet that already holds devnet SOL and re-run bootstrap:

```bash
solana transfer --url devnet --allow-unfunded-recipient <payer address> 2
```

or use [faucet.solana.com](https://faucet.solana.com).

The public devnet RPC endpoint is rate-limited, so a dedicated devnet URL in
`SOLANA_RPC_URL` makes the demo noticeably smoother. Without `DATABASE_URL`
the activity log, disclosure records and key-generation timeline live in
memory and reset when the server restarts; with a Postgres URL they persist
(tables are created on first connect).

### Roles and visibility

There are no logins inside the app. Each account page has a *Public observer
view / Owner view* switch (public by default), and the Audit Console has an
*Auditor view* switch (off by default). The frontend sends whatever is
switched on as an `X-Demo-Roles` header, and the server redacts confidential
balances, transfer amounts and disclosure records for anything that is off,
and refuses owner or auditor actions the request is not viewing as.

That header is a UI switch, not a credential. What it preserves is the
*shape* of who-sees-what, decided in one place on the server
(`src/lib/server/roles.ts` and `state.ts`). The deployed app is gated by the
platform's Google SSO; the signed-in identity is shown in the sidebar for
display only and never used for authorization.

### Key derivation

The ElGamal and AES keys that encrypt a persona's confidential balance are
never stored. They are derived on every use from the persona's Ed25519
signature over `solana-conf-bal/v1 || <token account>` using
`@solana/zk-sdk`'s HKDF-SHA512 scheme (`src/lib/server/keys.ts`).

Auditor key generations are derived the same way from one auditor root key,
seeded with `<mint> || <generation number>`. Rotation therefore needs no new
key material anywhere: the mint is pointed at generation N+1, and the active
generation is resolved from the auditor key the mint currently carries, so a
fresh container reconstructs the timeline from chain state alone.

## Checks

The CI workflow in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)
runs the same commands:

```bash
cd console
bun run check                                   # svelte-check
bun run test                                    # vitest: key derivation, ciphertext
                                                # arithmetic, roles, amounts, store,
                                                # i18n parity, redaction, permissions
bun run build
BASE_PATH=/confidential-balances bun run build  # the base path the platform deploys under
```

`bun run spike` runs a full mint → deposit → apply → confidential transfer
(one V1 transaction) → auditor decrypt → wrong-generation fails → apply →
withdraw round trip against devnet. It spends devnet SOL and mutates the demo
accounts, so it is a script rather than a test.

## Deployment

The app is deployed to the Solana Foundation artifact registry (Cloud Run
behind Google SSO) as `confidential-balances`, following the
`deploy-artifact` skill: tar `console/` (excluding `node_modules`,
`.svelte-kit`, `build`, `.git` and `.env*`), `create_upload_url` →
`deploy_app`, then `provision_database`, then upload `console/.env` with
`create_secrets_upload_url` → `set_secrets`, then `attach_shared_key` for a
devnet-capable RPC key. The server prefers an attached `HELIUS_RPC_URL`
(swapping its mainnet host for devnet) over `SOLANA_RPC_URL`, and skips any
shared URL it cannot use on devnet.

## Deliberate simplifications

These are choices, not oversights, and each has an obvious production
counterpart:

- **Keys on the server.** Personas sign with keypairs the server holds.
  Production needs wallet-approved signing per party.
- **Role switches instead of authentication.** Owner and auditor views are
  toggled in the UI and sent as a header. Production needs real identity;
  the server-side redaction and permission checks would stay as they are.
- **The service pays every fee** from its own payer keypair, and the UI says
  so. Production would have each party pay or a bank sponsor explicitly.
- **A single Postgres table per log** stands in for an indexer.
- **Devnet only.** Nothing here has been run against mainnet.
