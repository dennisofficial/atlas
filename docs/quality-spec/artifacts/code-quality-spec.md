# Code Quality framework: implementation specification

Planning deliverable, 2026-10-06. Full implementation index: [plan.md](../plan.md). Product choices and proposed defaults: [decisions.md](../decisions.md). Repository code is untouched.

## What will be built

A shared harness-level, advisory review module. Successful file edits carry exact operation input/output snapshots to source-scope adapters; applicable registered policies build atomic Jev questions; pure interpretation and event-derived finding episodes decide whether to add a finite nudge. No default block, rollback, second prose model, permanent prompt warning, or automatic repair loop.

Initial policy: single responsibility, independently maintained and toggled. It compares complete before/after class/function scope and actual change, not an isolated hunk or a broad SOLID checklist. Policy guidance is deterministic. One open episode per policy/scope avoids repeat warnings when a corrective edit is unchanged or improving.

Separate shared evaluation infrastructure: general-purpose root evals workspace, pinned Evalite backend, exact expected/actual policy grading, real-session corpus curation and verified labels, baseline/candidate comparisons, separate quality/performance/operational errors, compact agent summaries with full evidence on disk. Compaction and future features can supply their own suites later without making the runner Code Quality-specific.

First-class Code Quality settings: master on/off, descriptor-generated policy booleans, explicit opt-in local example collection, and honest last-recorded review status through active runtime adapters. No prompt editor or mandatory eval dashboard.

## Parallel workstreams

| Owner | Workstream | Detailed spec |
|---|---|---|
| Main | Contracts, ledger/schema, shared composition, integration and verification | [00](../sections/00-shared-contracts.md), [06](../sections/06-parallel-integration-and-validation.md) |
| Capture teammate | Direct-edit capture and TypeScript/JavaScript scope adapters | [01](../sections/01-change-capture-and-scopes.md) |
| Review teammate | Review execution, finite feedback, optional examples and isolated SRP policy | [02](../sections/02-review-engine-and-findings.md), [04](../sections/04-srp-policy.md) |
| Evaluation teammate | Shared runner, deterministic scorers, datasets, integrity and agent reports | [03](../sections/03-shared-evaluation-infrastructure.md) |
| Surface teammate | Registry-backed settings and current-runtime recorded health UI | [05](../sections/05-settings-and-surface.md) |

Main lands the pure contract bootstrap first. Four peers then start disjoint worktrees from updated origin/main; no inferred feature-branch stack. Typed fakes let source/review/eval/UI develop simultaneously. Only main edits common exports, dispatcher, root wiring, lockfile and protocol; peers hand off requested changes. Each section contains exact existing path:line evidence, proposed modules/signatures, ownership exclusions, tests and validation commands.

## Concrete proposed initial defaults

- Direct write/edit/multi_edit only; named TS/JS/TSX/JSX class/function scopes, including listed JS/TS module extensions. Shell/MCP/external mutations and other languages explicitly not covered.
- Harness parser dependency matches existing TypeScript 6.0.3 pin; no TUI parser dependency.
- Quality model pinned to current Jev 1.13.0; returned confidence/model identity preserved. Other decision clients retain defaults.
- Master quality.enabled off until efficacy evidence exists; SRP selected by default but inert under master-off; raw example collection off until explicitly enabled.
- Joined async review deadline 1000ms; input-size bounds and no silent clipping; actual synchronous preparation and p50/p95 measured, not a hard real-time promise.
- Compact review bookkeeping survives destructive summary but is not model/summarizer speech. Nudge lifetime is one assistant step.
- Evalite stable 0.19.0 + Vitest 4.0.1 + Vite 6.4.1 are dev-only; Node-target production leaf adapters, fresh per-run storage, manifest/row integrity, no default live call/UI server.
- Canonical nested evals/ATLAS.md plus feature-specific child guidance. Root instructions unchanged.

These are specification defaults selected to make the implementation buildable, not previously asserted operator decisions. They are explicitly listed separately from locked product choices.

## Important evidence-driven constraints

- Old session records usually retain requested after content or small normalized diffs, not complete historical before/after scopes. Do not invent real examples from today's files; accept only reconstructable sanitized exports or prospective opt-in captures.
- Finding state must survive compaction, reopen and transfer. Operational ledger authority remains the event log; optional raw examples are supplementary evidence.
- Serial pending calls currently reuse an old event snapshot; integration refreshes before each run so the second write sees the first finding.
- Publication listeners currently can throw after append is durable; integration contains listener failures so recorded success cannot appear failed.
- New event discriminant requires matched TUI/serve protocol negotiation (next version after current 17), not a new quality websocket frame.
- Stable Evalite exports can otherwise select an old run or omit trial identity; the thin integrity wrapper uses fresh in-memory storage, explicit IDs and exact planned coverage.

## Completion gates

Engineering tests, fake installed Evalite/Node smoke, parser builds in both binaries, main/sub/teammate/serve parity, compaction/rewind/fork/transfer behavior, and terminal completion preview. Live model quality is separate: verified real-session development/holdout data, identical baseline/candidate conditions, precision/recall/FPR/abstention/repeat measures plus latency and explicit operational errors. No calibrated/default-on claim based only on synthetic unit tests.

Initial curation target is 48 accepted real edits plus separate probes, contingent on usable explicit exports; expand representative coverage over time. No fixed universal accuracy threshold is guessed before baseline calibration. Missing data/provider/toolchain compatibility remains a visible gate, not hidden passing behavior.

## Review status
Independent spec review completed once and produced ten issues; corrections are applied: durable append cannot be rejected by malformed advisory drafts, logical workspace identity survives lift/descend, full request size gates map to the pinned model, parser stays policy-neutral, resolution has hysteresis, strict text capture uses byte reads, examples land per owning thread, prospective examples have an explicit export command, Vitest runner dependencies are unified, and the eval dependency/bootstrap is required. A bounded follow-up re-review is checking the corrections. No implementation, install, live model call, commit, PR or preview was performed in this planning turn.
