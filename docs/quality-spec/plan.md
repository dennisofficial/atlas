# Code Quality framework and shared AI evaluations

## Goal
Buildable specification for a first-class advisory Code Quality module, registered narrow policies, and general agent-oriented AI evals, partitioned for four parallel teammates plus main integration. This turn is planning only; no implementation, installs or Git changes.

## Product intent
Successful direct writes remain successful. Review compares before/after semantic scopes and the actual diff, then adds a finite advisory only for a newly notifiable finding episode. Jev returns bounded decisions; deterministic policy guidance renders coaching. Policies are independently adjustable and composed in every harness session kind. Settings expose policies, not prompts. Shared eval infrastructure supports Code Quality, compaction and future AI features; policy scoring is deterministic expected-versus-actual comparison over verified cases.

## Architecture
```text
Direct file tools (capture under existing lock)
  → immutable changes → harness source adapters
  → applicable policy registry → atomic Jev questions per scope
  → deterministic interpretation + event-derived episode lifecycle
  → ordered successful result / compact review records / finite nudge

Shared eval workspace (development only)
  → real/synthetic versioned cases → same production preparation/interpretation
  → pinned Evalite + supervised Node adapter
  → deterministic graders / separate quality-errors-performance / compact artifacts

TUI and serve use shared harness composition
  → descriptor-generated policy controls + last-recorded status
```
Core owns pure contracts/registry/request/interpretation/lifecycle/projections; harness owns source I/O/parser, review execution and shared composition. No new production package is justified; evals is a development workspace, not a runtime dependency.

## Locked choices and defaults
[decisions.md](decisions.md) distinguishes Dennis's product choices from concrete proposed implementation defaults. Initial implementation: direct write/edit/multi_edit, supported TS/JS named class/function scopes; parser TypeScript 6.0.3; pinned quality model jev-1.13.0; advisory-only, master off until calibrated; opt-in local example collection; Evalite 0.19.0 development backend; shared nested evals/ATLAS.md instructions. One active finding episode per policy/scope is a deliberate conservative anti-recursion rule. No shell/all-language coverage claim.

## Read evidence baseline
Current transferred checkout: main at 293d199c94da5cf217f74cc7f5de8a57c0f0602e. Working tree clean at inspection. origin/main absent: paths/lines refer to this snapshot, not an assertion about remote main. Implementers must fetch and revalidate before branching. Main checkout stays read-only; each future teammate gets its own worktree from origin/main.

- [Runtime/capture investigation](evidence/runtime-seams.md)
- [Shared eval/toolchain/data investigation](evidence/eval-seams.md)
- [TypeSafe primary-source research](artifacts/typesafe-code-quality-research.md)
- [Existing framework comparison](artifacts/code-quality-evaluation-frameworks.md)

Notable findings: original scopes are not generally reconstructable from old session diffs; quality state must survive destructive summary; successive serial calls currently share stale events; durable append can currently be followed by throwing publication listeners; strict old clients cannot decode the new event discriminant. The spec assigns each issue to main integration, not an ad hoc policy patch.

## Ordered slices and owners
0. [Shared contracts and main-session ownership](sections/00-shared-contracts.md) — main defines and lands bootstrap before parallel code starts.
1. [Change capture and semantic scopes](sections/01-change-capture-and-scopes.md) — capture teammate: tools + AST source adapters.
2. [Review engine and finding lifecycle](sections/02-review-engine-and-findings.md) — review teammate: harness execution/collection/settings adapter.
3. [Shared evaluation infrastructure](sections/03-shared-evaluation-infrastructure.md) — eval teammate: generic tooling/corpus preparation/reporting.
4. [Isolated SRP policy](sections/04-srp-policy.md) — review teammate's first policy, eval handoff.
5. [Settings and surface](sections/05-settings-and-surface.md) — surface teammate: policy controls + honest active-runtime health.
6. [Parallel integration and validation](sections/06-parallel-integration-and-validation.md) — main: ownership matrix, start order, shared hot spots, test/build/live gates.

## Parallel start and handoffs
Bootstrap pure contracts and compatibility fields on origin/main first. Four peers then branch from fresh origin/main, consume section 00 and own disjoint files. Source/engine/eval/UI can use typed fakes while waiting for another slice, never duplicate it. Main alone edits cross-cutting exports/dispatcher/composition/lock/protocol; peers request exact changes. Integration validates assembled behavior and release evidence. No feature branch stacking inferred; no shared-worktree modifications.

## Acceptance
See section 06 for exact commands/gates: successful writes unaffected by faults/OFF; no recurring nudges; durable state across summary/rewind/fork/reopen/lift; local/sub/teammate/serve parity; compiled parser/binaries; real installed no-network Evalite smoke with exact coverage/fresh artifacts; real-session verified golden sets and held-out prompt comparison; compact agent reports with separate operational failures and latency; terminal completion preview during implementation.

## Out of scope
No implementation/preview/commit/PR during this spec turn. Initial implementation does not include shell/background/MCP/external mutation attribution, other-language parsers, global cross-thread dedupe, automatic repairs, blockers/rollbacks, file-restoring rewind, arbitrary dynamic policy loading, a second generic eval runner, or a compaction evaluation suite. The shared eval interface supports future suites without those being built now.
