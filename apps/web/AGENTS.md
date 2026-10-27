<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Live testnet runtime

- The shipped app must use real configured services only. Never add demo, synthetic,
  fabricated, or mock data/connection fallbacks to runtime or user-facing flows.
- Keep synthetic fixtures, mocks, and in-memory services confined to automated tests.
- Never import test helpers into runtime or seed receipts, bills, participants, prices,
  history, balances, or transaction results. User-entered data and genuine local
  encryption, storage, and OCR remain supported; fabricated service responses do not.
- Require the deployed HTTPS relay endpoint through `NEXT_PUBLIC_RELAY_URL`; never
  silently fall back to localhost in runtime.
- Missing, invalid, and unavailable services must show actionable errors, not demo data
  or simulated success. Show a connected state only after a successful real request.
- Never reuse or restore template Render/Vercel deployment URLs. This project will use
  new deployments; require their configured URLs instead of guessing hostnames.
- The app is testnet-only and hands ZIP 321 requests to an external wallet. Do not claim
  a transfer was broadcast or verified unless it was actually confirmed on-chain.

## Validation

The user lifted the validation freeze on 2026-10-27. Run tests, lint, typechecks, and
builds, fix failures without weakening checks, and record only executed results.
