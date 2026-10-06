# 06 — Parallel execution, integration and acceptance

## Goal
Make the preceding sections executable by peer teammates without overlapping ownership or guessing contracts. Main owns shared interfaces, hot-spot edits, assembled verification and shipping. No implementation teammate is started as part of this planning turn.

## Parallel ownership
| Owner | Slice | Exclusive implementation ownership |
|---|---|---|
| Main | 00 + integration | core quality contracts/registry/request/interpretation/lifecycle/health/event schema, shared exports, ToolOutcome/Invocation, AgentFileSystemPort.readTextForEdit + Local/Docker/Routed implementations, WorkspaceIdentityPort, Jev response/client compatibility, dispatcher/settlement/publication, root composition/container, settings enums/pages, root/harness manifests+lock, wire protocol, architecture and CI |
| Capture teammate | 01 | write/edit/multi_edit implementations + capture tests; harness quality/source/** and its tests |
| Review teammate | 02 + 04 | harness quality/** except source/**; core quality/policies/**; engine/settings adapter/example sink/health reader and tests |
| Evaluation teammate | 03 | evals/** including its new manifest after bootstrap; datasets/curator/artifact/reporting/shared instructions/Node smoke |
| Surface teammate | 05 | new TUI quality health hook/component/tests, named workspace/overlay/settings/head plumbing and their focused tests |

Teammates may use bounded builder/explore/reviewer sub-agents inside their slice; sub-agents stay in that teammate's worktree. No other worktree/branch edits, no root/main mutation, no autonomous cleanup of siblings. Shared-file requests go to main with exact desired changes, not surprise writes.

## Dependency graph and staged start

```text
Main contract bootstrap on origin/main
  ├─ Capture: metadata + AST scopes ───────────┐
  ├─ Review: engine + isolated SRP ───────────┤
  ├─ Evals: generic runner + fake adapters ──┤→ Main integration / live validation
  └─ Surface: descriptor UI + fake health ──┘
```

All four peers can code after the contract bootstrap; they consume the same contract files and use fake adapters when another slice is not ready. Source/engine handoff and production SRP adapter handoff are explicit checkpoints, not reasons to duplicate functionality.

1. **Bootstrap (main):** implement minimal pure contracts, registry/request helpers, lifecycle/schema/health projections, backwards-compatible optional tool/decision fields and focused tests. Add parser dependency pin and shared eval workspace skeleton/manifest pins as REQUIRED deliverables: bun install, scoped-overrides verification and the fake installed-runner gate must pass before slice 03 starts; no stub command promising functionality. Keep registry UI/root wiring and protocol bump for final integration. Land this small foundation PR before peers cut fresh branches so every branch is genuinely based on origin/main, not an inferred feature stack. If peers already have authorized worktrees, merge updated origin/main normally; never rebase/force-push.
2. **Parallel slices:** peers branch from freshly fetched origin/main under separate default worktree directories, each with its own spec section. Capture and review build against shared types; eval proves generic/fake toolchain first; surface builds against pure fake recorded health and live settings definitions. Evals teammate owns evals/package.json after bootstrap; main alone applies subsequent root/harness/lock changes by coordination.
3. **Handoffs:** capture supplies source/index.ts and tested coverage/identity mapping; review supplies quality/index.ts plus pure policy; eval uses actual preparation/interpretation and compiled Jev leaf; surface consumes public descriptor/health API. Main applies requested shared exports/registration. Peers do not implement alternate fallbacks when an upstream slice is incomplete.
4. **Integration (main):** merge/reconcile small independently reviewed slices, wire shared root, update event consumers/retention/protocol, run aggregate tests/builds/real-provider checks and preview. No partial PR title claims a usable feature before a working policy/system exists. User-authorized implementation follows repo draft-PR/CI/merge workflow; this spec-only task does not commit/push.

Each future teammate brief must point to plan.md, decisions.md, section 00 and its owned section; repeat only current base revision and excluded files. Ask reports to include commands actually run, artifact paths, coverage limitations, unresolved integration dependencies and changed source files. Main checks changes against the spec before calling a slice done.

## Main integration edits, anchored to code actually read

### Dispatcher and fresh settlement
- packages/harness/src/tools/dispatch.ts:67-79: optional quality dependency; :120-135 success integration; :284-305 existing result serializer.
- Keep dispatcher <=300 lines by moving existing resultDraft function to a focused tools/tool-result-draft.ts, then adding a focused quality-dispatch.ts helper rather than a large inline block. Helpers keep original public output/modelText and handle a faulty/slow review port without replacing write success.
- tool.ts:146-210 forwards optional captureFileChanges in ToolInvocation/ToolRun/SchemaTool. Dispatcher gets port.captureEnabled once per invocation; engine rechecks switches before reviewing.
- packages/harness/src/loop/settle-pending.ts:68-94: pending list remains a snapshot, but reread raw events at each partitioned run before dispatch. Each write is a singleton run. Recompute no pending calls mid-loop; preserve unsafe barriers and call-order result publication.
- Quality helper creates joined deadline/turn abort, races even a signal-ignoring port, and produces an operational fault/coverage draft on throw/timeout. Engine consumes the same signal/deadline; no second independent timeout that can outlive settlement. Synchronous parser prep is bounded by supported input sizes and measured; 1000ms is an async responsiveness budget, not a hard real-time OS guarantee.

### Composition and settings
- packages/harness/src/container/create-harness-container.ts:240-249: optional resolve of QualityReviewPort in shared dispatcher factory.
- composition/compose.ts:142-156: after DecisionPort binding/stores/plugin registration but before session machinery resolves, register quality implementation, descriptor settings and optional example sink using current session thread data directory. New main helper composition/compose-quality.ts may carry this wiring to stay focused.
- composition/compose-utility-models.ts:43-45: reuse DecisionPort; no new risk JudgePort or Haiku fallback for quality.
- core/settings/definition.ts:3-10 and registry.ts:8-14,16-62: add CodeQuality page/standard IDs/master+example collection definitions. Per-policy booleans come from descriptor adapter, not a central SRP-specific UI switch. Settings closure reads live snapshot, not compose.ts:86 frozen startup resolution.
- harness/settings/service.ts:194-199: startup/additive registration works; do not claim hot removal/replacement. Existing generic user-document sync carries scalar toggles to serve without a new wire frame.
- Child/teammate harness runner must inherit the configured quality port/registry/settings from shared root; no TUI-only feature fork. Add main/sub/teammate/serve parity tests rather than assuming root path alone proves this.

### Event lifecycle, transport and publication
- core/events/body.ts:78 onward + :265-272 and events/schema.ts:99 onward: add isolated imported quality event/schema and preservation list entry. Keep source strings out of retained bookkeeping; use self-contained statuses/assessments/scope snapshots.
- compaction/watermark.ts:19-32 and store/sessions/thread-store.ts:364-384: preservation must keep ledger authoritative under destructive summary and rewind floor correct. Render-range/messages-from-events ignore bookkeeping; finite nudge alone teaches the next model step. No new permanent context slot or transcript row.
- core/events/rewind-plan.ts:49-53,119-130: do not add quality records to physical-notice replay.
- harness/cloud/session-wire.ts:42-53 parses body strictly; older client cannot decode new discriminant. Bump packages/wire/src/channel-wire.ts:17 protocol 17→18 (or next available current version after rebase), update __tests__/channel-wire.spec.ts:142-145 and mismatch/version tests. No new quality frame. This is deliberate compatibility negotiation, not an assumption that unknown body fields are safely ignored. Matched TUI/serve releases/sandbox image must be tested.
- channel/delta-channel.ts:63,92-94: make createDeltaChannel accept optional named onListenerError callback and contain each listener independently, continuing delivery. Shared root binds logger. Existing eventsAppended protection at :193-204 provides the pattern; settleAppend/endStep at :207-214 must not throw after a durable append because of a subscriber.
- channel/publishing-event-log.ts:7-10: still append THEN notify; add tests that durable success cannot appear failed due to listener exceptions. Do not use raw app.log append for quality feedback.
- Core exports index.ts and harness index.ts remain main-owned. Public surface access includes descriptors/readQualityHealth, not executable policy/parser internals.

### Documentation and CI
- Update docs/architecture.md at quality composition/event-retention seams and remove/correct stale per-tool snapshot mechanism paragraphs (:180-182,:1015-1021) against current WorkspacePort/dispatch; do not resurrect file restoration on rewind.
- Root instructions remain untouched. Shared eval guidance is nested evals/ATLAS.md and suite-specific child file.
- .github/workflows/ci.yml:44-52,118-119 already run root typecheck/build and non-TUI package tests. New dev workspace's default tests are strictly fake/no-network, so they may join ordinary CI. Add explicit Node setup using .nvmrc where fake Evalite smoke executes, rather than depending on runner-installed Node. No live model calls/credentials in default PR CI. Live evals are an explicit manual/local step with artifacts.
- Root scripts and Turbo graph must not cache model calls. Root `eval` invokes the eval workspace directly; existing typecheck/test/build graph keeps package dependency invalidation. Evalite does not enter TUI/serve runtime dependency/bundle graphs.
- Eval bootstrap dependencies are required and verified before slice 03 starts. Root overrides use the parent-scoped form `"evalite": { "@vitest/runner": "4.0.1", "@vitest/utils": "4.0.1" }` so Evalite and direct Vitest share one 4.0.1 runner instance WITHOUT forcing apps/api's Vitest 3.x or Storybook onto it; first gate includes the api vitest suite staying green. Main inspects lockfile and install lifecycle results rather than assuming resolution.
- Main updates wire protocol constants/tests and coordinate sandbox image compatibility intentionally. For strict event body schemas, add a focused compatibility test proving unknown new body types fail legibly on old clients and matched versions decode quality records.

## Aggregate verification commands (implementation worktree only)
1. `bun install` after coordinated named manifest/lock changes; inspect blocked lifecycle scripts, do not blanket trust or ignore install errors.
2. `bun run typecheck` root, including core/harness/tui/serve/wire/evals.
3. `bun run test --filter @dltech/atlas-core --filter @dltech/atlas-harness --filter @dltech/atlas-wire --filter @dltech/atlas-evals --concurrency 1` under isolated ATLAS_HOME. Includes malformed-quality-draft containment, lift/descend namespace stability, child-thread example path, strict text capture, request-size skip, parser multi-scope and duplicate Vitest runner gates. TUI `NODE_ENV=development bun run test` in apps/tui (sharded package script). Any unrelated load flake is verified against baseline/isolated rerun, not silently ignored.
4. Source/routed filesystem/quality engine/settlement/schema/summary/rewind/fork/publishing/archive focused suites, then main+sub+teammate+serve parity fixtures.
5. Fake Node Evalite smoke through actual compiled production adapter, success/quality-fail/infrastructure-fail artifacts and exact trial coverage. No live endpoint in ordinary engineering tests.
6. `bun run build` from apps/tui and `bun run build:serve` from apps/serve; boot/version smoke with dedicated scratch ATLAS_HOME. Check binary dependency graph does not contain eval framework.
7. If Docker available, ATLAS_LIVE_DOCKER=1 focused routed write capture specs in isolated execution; otherwise record missing live backend evidence explicitly.
8. Explicitly authorized representative real Jev evals: same frozen versioned dataset/model conditions for baseline/candidate; primary quality score + per-impact metrics, coverage, repeatability and latency; full artifacts and concise summary. Missing real pairs/model service means no calibrated claim.
9. Terminal preview via apps/webterm in cloud after integration (see apps/webterm/README.md), with isolated scratch session and operator URL. QA matrix is in section 05. No human dashboard is required for evals themselves.

## Acceptance and evidence gates
Engineering gate: one registered policy and a second fake policy work through identical contract; file writes still succeed on all review faults; OFF preserves behavior; stable finding episodes survive summaries/reopen and don't recurse; no stale serial-call history; model/scope/capture faults never look clean; source examples opt-in and local; active runtime UI honest; matched local/Docker/cloud composition; parser loads in compiled binaries.

Eval infrastructure gate: actual installed runner, exact accepted schema/case/trial coverage, no label leakage, fresh artifacts even on crash/empty import, finite scores, operational errors separate, compact outputs, raw evidence retrievable, no real home scan/default live calls. Exact-match 8/10 demonstrates 80% independently per metric. Another generic fixture shows infrastructure not SRP-specific.

Policy efficacy gate: accepted real-session corpus with independently verified expected outputs and grouped holdout. No fixed universal accuracy floor is asserted before baseline. Record proposed/selected per-metric gates in versioned manifest BEFORE candidate comparison; don't loosen to fit a failing candidate. Aim high precision for unsolicited advice; report recall/FPR/abstention/repeats rather than one averaged score. Keep master default off until this evidence exists, even if engineering implementation ships.

No claim of all-language/all-write/global transaction/global dedupe coverage. Initial TS/JS direct tool coverage and unsupported cases are visible. Historical missing before-scopes cannot be solved by assuming current files; prospective example collection is the bounded path forward.

## Planning completeness versus implementation completion
This spec is complete when an independent reviewer finds no unresolved interface/ownership/validation contradictions. The files here are session artifacts, not committed repository changes. During later implementation, failed tests/compatibility/data gates remain open tasks and must be reported, not called done. The repo's done-means-shipped workflow applies only once implementation is requested.
