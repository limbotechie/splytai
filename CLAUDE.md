# Read this before any work

Project continuity lives in `implementation docs/` (gitignored on purpose; if it is
missing, stop and ask the user).

Read `implementation docs/PROJECT_CONTEXT.md` first, then
`implementation docs/AGENTS.md` for the full instruction set, then
`implementation docs/IMPLEMENTATION_PLAN.md` for phase scope and the executed-checks
ledger.

Update `PROJECT_CONTEXT.md` before you end a session and always after finishing a phase.

Key rules: the user authorized tests, lint, typechecks, and builds on 2026-10-27. Git
operations require explicit authorization; commits for the initial project snapshot were
authorized on 2026-10-27. Never read real `.env` values, spend on mainnet, weaken a test,
or report an unexecuted check as passing.

Runtime is real-service, testnet-only. No demo, synthetic, fabricated, seeded, or mocked
runtime data or connection fallbacks. Keep test doubles in automated tests only. Require
the configured HTTPS relay, surface missing/offline services honestly, and never show a
successful connection or payment merely because a URL is configured or a wallet opens.
Inherited Render/Vercel deployments belong to the template. Never reuse, probe, or
restore those URLs; the user will configure new deployments for this project.
