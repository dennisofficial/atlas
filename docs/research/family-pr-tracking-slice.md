# Family-wide PR/CI tracking

**Goal:** PR and CI tracking covers the whole session family. A teammate entering a worktree whose
branch holds a PR is tracked immediately, exactly as the main agent is. The PR pill shows on the
teammate's sidebar card and in the main PR sidebar (teammate-origin tag is a later prototype).

Worktree: `/atlas/workspaces/atlas/.atlas/worktrees/family-pr-tracking`, branch
`dennis/family-pr-tracking`, base `origin/main` (bf331e17c).

## Governing design

See `docs/research/family-pr-tracking-slice.md` (repo) for the full design and the singular-assumption
table. Locked decisions are in `decisions.md`.

Core insight: the loop already visits every family thread through hook phases carrying its identity
and place — `BeforeTurn { threadId, projectDirectory }`, `AfterTool { projectDirectory }`,
`AfterShell { threadId }`, `OnThreadOpen { threadId, projectDirectory }`. No new roster event; a
hook-driven **family tracker** reconciles the tracked checkout set per thread at these boundaries.

## Slices (disjoint trees)

### A — harness core (load-bearing) — `packages/harness/src/plugins/github/`
1. `pull-request-service.ts` — `tracked` becomes a set keyed by `checkoutKey`. `track({ checkouts })`
   reconcile (mirrors `watch({links})`): gained key force-read at once, lost key forgotten + in-flight
   dropped. Replace single-slot `track`/`stopTracking`. `expectingUntil` per-key (`Map<string,number>`).
   `expectChecks({checkout})`/`recheck({checkout})`. `current()` = visible thread's tracked checkout
   (footer), add `tracked(): RepositoryCheckout[]`. `states()` folds tracked set + watched links.
2. `tracking.ts` — family tracker: `Map<ThreadId, RepositoryCheckout>`, probes each thread's
   `projectDirectory` on BeforeTurn/OnThreadOpen, calls `track({checkouts})` with the union. Serve
   `boot()` (cloud fold + probe) feeds the same set. Drop the `current()!==null` single-slot gates.
3. `hooks.ts` — `tell()` gains the checkout: AfterTool resolves from `projectDirectory` (probeCheckout),
   AfterShell from `threadId` (tracker lookup). Per-checkout expectChecks/recheck.
4. `links.ts` `recordFound` — AfterTurn drafts `pull-request-linked` from the calling thread's tracked
   checkout (`AfterTurn {threadId}` → tracker), not the global `current()`.
5. `pr-event-routing.ts` — `watching()` admits a frame matching any tracked checkout's PR or any link.
   Notices still queue to main thread (per-child delivery deferred).
6. `pr-transitions.ts` — diff the tracked set per-key; route each note to the owning thread's next
   BeforeTurn.
7. `ci-watch-hook.ts` — gate on the calling directory's tracked reading, not single `current()`.
8. `index.ts` — wire the family tracker into the existing hook list; SessionFacts stays the
   visible-thread fact the TUI footer reads.

Pin specs to update: `packages/harness/src/plugins/github/__tests__/` — tracking, pull-request-expecting,
pull-request-watching, pull-request-service, pull-request-states-wire, serve-boot, hooks, ci-watch-hook.

### B — TUI surface — `apps/tui/src/plugins/github/`
1. `use-pull-request.ts` — retire visible-conversation `track`/`stopTracking` (L177, L189-193); the
   family tracker owns the set. Readings via `service.snapshot({key})` (set-safe).
2. `pull-request-entries.ts` + surface/sidebar — `pullRequestEntries` takes the tracked set; sidebar
   one row per tracked PR + links; footer chip = visible thread's tracked PR (fallback newest link).
3. Teammate-card PR pill — TEAMMATES panel reads each teammate thread's tracked checkout (keyed by
   threadId) and renders the pill. Origin tag deferred.
4. Cloud path — `states()` already broadcasts the set; confirm teammate checkouts render (same set).

Specs: `apps/tui/src/plugins/github/__tests__/use-pull-request-triggers.spec.tsx`, follow-session.spec.tsx.

## Sequencing
A first (B needs A's service interface), then B. Review assembled diff → typecheck + targeted tests → PR.

## Validation
- `turbo run typecheck --filter @dltech/atlas-harness` and `--filter @dltech/atlas`.
- Targeted `bun test` on touched specs.
- Family behavior spec: second thread on a PR branch → service tracks both checkouts and a teammate
  push's `expectChecks` targets the teammate's key, not the main thread's.
