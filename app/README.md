# Confidential Balance Console (frontend)

Next.js 16 / React 19 / Tailwind 4 console for the Confidential Balance
demo. It holds no keys and no secrets; every balance, signature and
disclosure it shows comes from the Rust devnet backend in
[`../rust-service`](../rust-service), which must be running first. See the
[root README](../README.md) for the full picture.

```bash
pnpm install
pnpm dev          # http://localhost:3000, expects the backend on :8787
```

Set `NEXT_PUBLIC_BACKEND_URL` in `.env.local` if the backend runs elsewhere
(see [`.env.example`](./.env.example)).

## Layout

- `src/app/` — routes: the dashboard, `/accounts/[id]` for each persona, and
  `/audit` for the auditor console.
- `src/components/flows/` — the send, deposit/withdraw and mint drawers.
- `src/store/demo-store.ts` — zustand store: backend state, which owner and
  auditor views are switched on, and client-side redaction that mirrors the
  backend's.
- `src/lib/backend/client.ts` — the only place that talks HTTP.
- `src/lib/i18n/` — English, Simplified and Traditional Chinese copy. Every
  user-visible string lives here; a test enforces key parity across locales.

## Checks

```bash
pnpm lint
pnpm test         # vitest
pnpm build
pnpm typecheck    # regenerates Next's route types, then tsc
```
