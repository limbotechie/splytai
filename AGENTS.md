# Read this before any work

Project continuity lives in `implementation docs/`. That folder is deliberately
gitignored, so it will not appear in a checkout — if it is missing, stop and ask the
user rather than guessing at project state.

Read, in this order:

1. `implementation docs/PROJECT_CONTEXT.md` — objective, hard constraints, settled
   decisions, phase status, known gotchas, dated log.
2. `implementation docs/AGENTS.md` — the full instruction set.
3. `implementation docs/IMPLEMENTATION_PLAN.md` — phase scope and the ledger of checks
   actually executed.

Update `PROJECT_CONTEXT.md` before you end a session and always after finishing a phase.

Non-negotiables (full detail in the files above):

- **Validation authorized (2026-10-27):** the user explicitly requested tests, lint,
  typechecks, and builds. Run the relevant checks and record their actual results.
- No Git operations without explicit user authorization. The user authorized commits for
  the initial project snapshot on 2026-10-27; do not make further commits or initialize
  another repository without a new request. Never read real `.env` values, spend on
  mainnet, or weaken tests to make them pass.
- Shipped runtime must use real configured services only: no demo, synthetic, fabricated,
  or mocked data/connection fallbacks. Test fixtures and mocks are permitted only in tests.
- Never seed user-facing bills, receipts, participants, prices, history, or transaction
  results. Never import test doubles into runtime or simulate a successful connection.
- Missing or unavailable services must produce an explicit configuration/offline error,
  not sample data or an implicit localhost connection. A configured URL is not proof of
  connectivity; show connected only after a successful request to the real service.
- Template Render/Vercel deployments do not belong to this project. Never reuse, probe,
  or restore inherited deployment URLs; require the user's new deployment configuration.
- The app is testnet-only and uses external-wallet ZIP 321 handoff. Do not claim that a
  payment was broadcast or verified unless it was actually confirmed on-chain.
- Never report an unexecuted check as passing.
