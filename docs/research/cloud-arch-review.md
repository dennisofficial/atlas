# Cloud container architecture review

**Date:** 2026-10-13. **Scope:** the whole Atlas Cloud container setup — lifecycle (birth, park,
wake, hot-swap), module boundaries, skills delivery, memory sync, reconnection machinery, and
state ownership — read against the *target* architecture after decision #13 (greenfield: no cloud
sandboxes in use, the relocation engine is being deleted, every thread is born-placed). Read-only
audit; nothing here is implemented.

**Method.** Six area audits (lifecycle, module boundaries, skills, memory, reconnection, state)
were run as parallel read-and-report passes over `origin/main` (`1084d015a`), each returning
file:line-anchored findings; their full reports are preserved in the session context under
`context/review/{lifecycle,modules,skills,memory,reconnection,state}.md`. Every load-bearing claim
cited below was re-verified against the tree by the reviewer before inclusion. Judged against:
`docs/architecture.md` (three-strata model — feature / runtime / transport; features live in
harness, surfaces own none; core performs no I/O), `docs/core-contract.md` (log is authoritative;
one record), `docs/research/cloud-session-placement-models.md` (the amp/Claude Code placement
research), and the program's locked decisions (`decisions.md` #1–#13).

**Caveat on timing.** The tree is mid-transformation: slice 06 (user-layer sync) has landed
(#1229), slice 07 (session mirror) is being built concurrently, slice 08 (relocation deletion) has
not started. Findings about code that slice 07/08 already owns are marked **[slice-07]** /
**[slice-08]**; they are included because the review's job is to judge the target, and the target
is only reachable if those slices' stated scopes actually cover what the audit found.

---

## 1. The target architecture, in one page

The greenfield model, as the locked decisions intend it:

**Placement is chosen once.** Every thread is born-placed (#2, #13): the composer placement chip
(#8, #11) picks cloud or host before first send; birth is blocking-but-cancellable with real
progress (#9, #11); a pre-send flip discards the unstarted birth and rebirths with the draft
(#12). After first send, placement is immutable — not guarded, *unwritable*. The relocation
engine (lift/descend, portable state, context archive) is deleted early (#13); the placement move
machinery in `PlacementController` goes with it, leaving `placeAtCreation` / `markBorn` /
CAS-on-revision as the whole write surface.

**One runtime, wherever it runs.** Serve-in-sandbox composes the same `composeHarness` with the
same port manifest (#6): adding a port without its runtime and transport bindings breaks typecheck
in both `apps/tui` and `apps/serve`. The sandbox is a runtime, not a stratum; `apps/serve` is
transport; `packages/wire` is the contract. The TUI renders a cloud thread through the mirror and
the channel, owning no feature logic.

**The lifecycle has one story.** Provision → serve → (hot-swap at wake boundaries, drain-sealed)
→ park → wake → destroy. Hot-swap stays (#1) — and, per the placement research (§5.4), it is more
aggressive than anything publicly documented: amp, the closest comparable, only drain-restarts its
long-lived runner *when no thread is running*. Under born-placed, cloud sessions are longer-lived
(they can never be lifted home to escape a bad serve), so the drain path and the park/wake swap
window carry more weight than they did when #1 was locked. The state the lifecycle moves through
lives on the drive (event logs, thread metas, rotation receipt, runtime checkpoint, sync cursors);
the API DB holds identity, tokens, subscriptions, and projections — never loop state.

**The user layer is a sync domain, not a snapshot.** Skills, instructions, and memory sync
bidirectionally through the API's per-file store (#3): content-hash diff on scan, server-revision
CAS, tombstones, conflict copies, `MEMORY.md` union-merge. Silent and non-blocking (#5): boot/wake
pulls latest; failure keeps the drive's last copy. This replaces context-archive outright (#13).

**Session data is a mirror, not a cache.** While connected, event-log deltas stream down the
channel and the local copy of the session directory is current by construction (#4); reconnect
re-snapshots. Cloud is the source of truth; flow is downward only; the one stale case is
disconnected. Slice 07 generalizes the existing transcript-mirror pattern (signal → tail pull;
`Reload` → digest-verified rewrite; remote wins, never merge) to the whole session directory.

**What "done" looks like.** A reader can name, for each kind of cloud-session state, its one
authority and its survival boundary; every serve-side ceremony is a registered port's runtime
binding; birth is a first-class harness operation with no dependence on deleted code; and the
reconnect ladder is one explicit state machine that the warm pool (#10) can plug into as a sixth
entry point without archaeology.

---

## 2. Findings by angle

Severity: **[structural]** — boundary-level; shapes what the remaining slices land on.
**[worth-fixing]** — localized, real cost. **[fine]** — verified healthy; recorded so nobody
re-audits it.

### 2.1 Architecture — the cloud session lifecycle

- **[structural] The lifecycle state machine is emergent; no type names it.** "What stage is this
  sandbox in" is inferred fresh in four places: the driver's `probeSandboxForResume`
  (`packages/harness/src/cloud/resume-probe.ts:185`) infers from provider status + stamp files + a
  health probe; serve's recovery infers from `operational/sandbox-rotation.json`
  (`apps/serve/src/serve-rotation-recovery.ts:27`); the runtime checkpoint maintains a third
  record (`phase: running/rotating/parked`, mirrored to the API); and `PlacementRecord.move` is a
  fourth, in thread meta. `ESandboxProbe` is a decision enum, `ERuntimePhase` is checkpoint
  vocabulary, `EPlacementMovePhase` is placement vocabulary — none is the lifecycle. The five
  phase-1 defects (admission wedge, wake loop, swap race, park-proof, heartbeat storm) were each
  fixed by adding another inference edge to this graph. Cross-record invariants (receipt
  sessionId == checkpoint sessionId) are enforced by a zod refine and convention.
- **[structural] Placement has two writers with different rules.** `PlacementController.write`
  (`packages/harness/src/composition/placement-controller.ts:252`) is the designed path — CAS,
  monotone revision, publish gates. `apps/serve/src/placement-hydration.ts:37` calls
  `threads.writePlacement` directly, hand-computing `revision: held.revision + 1` and clearing
  `move`, on the boot path where a stranded move is the *normal* case. **[slice-08]** — this is
  relocation-restore machinery; under #13 the whole function shrinks to "born record exists or
  boot refuses," which makes the bypass deletable rather than fixable. But slice 08's stated scope
  does not name it (see 2.2, finding on deletion coverage).
- **[structural] The client-side placement record is silently lossy.** `RemoteThreadStore`
  never overrides `readPlacement`/`writePlacement`, so the TUI's record of a cloud thread is
  synthesized as `{ revision: 0, move: null, born: null }` from the location column
  (`packages/harness/src/store/sessions/thread-store.ts:76-87`). Nothing explodes today because
  the synthesized answer happens to be right; under #13 the never-moves invariant is unenforceable
  on the surface that originates move intents, because `born` never crosses the wire.
- **[structural] Serve performs feature policy in at least three places**, contradicting
  surfaces-own-none: placement hydration (above); the park ceremony (`apps/serve/src/serve-lifecycle.ts:67`
  — admission ordering, parked-marker append, finalized/unfinalized reopen rule, provider-stop
  retries), whose `:100` comment admits it works around the raw-log append being silent — a
  harness publishing-coverage gap patched in the surface; and the drain ceremony
  (`apps/serve/src/serve-drain.ts`). None of these is a registered port; all are invisible to the
  #6 contract. The TUI can never park a session the way serve does — it can only ask serve to.
- **[structural] Hot-swap is a six-module handshake across three packages, not a deep module.**
  probe (`resume-probe.ts`) → drain decision → `/v1/drain` (`serve-drain-client.ts`) →
  `createServeDrain` → receipt (harness fs helpers, wire schemas) → next boot's
  `serve-rotation-recovery.ts`. `VercelDriver.createOrResume` hides the happy path only; any
  forensic question ("was that drain consumed?") requires knowing the internal layout. Decision #1
  locked the seam count; the module boundary was drawn around transport and app lines, not around
  the operation.
- **[worth-fixing] `resume-probe.ts` mixes pure decisions with orchestration** — `serveAgeOf`,
  `servePredatesDrainProtocol`, `runtimeIdleOf` are exactly the "hard to test → move to core"
  pattern CLAUDE.md names, trapped in a file that fetches and deletes. Also: the health payload's
  guarded-field list (`GUARDED_FIELDS`, `resume-probe.ts:65`) is the client's copy of what serve
  must always send, enforced nowhere; a dropped field silently downgrades drain decisions to
  Unknown (the safe direction, so convention-not-type).
- **[worth-fixing] The drain reply's 25 ms flush window** (`serve-drain.ts:36`,
  `REPLY_FLUSH_MS`) is sleep-as-protocol. The design holds (receipt is durable before the reply;
  the client re-reads it), but the mechanism invites a future "simplification." Tie it to response
  completion, not wall time.
- **[worth-fixing] The parked-marker append hand-publishes around a known harness gap**
  (`serve-lifecycle.ts:83-103` reaches for `channel.publisherFor` because a raw `EventLogPort`
  append emits nothing). Small, but exactly the "surface gets an adapter or a port, not a
  reimplementation" violation shape — the kind of patch that fossilizes.
- **[fine] Verified healthy:** the swap lock (`packages/wire/src/sandbox-swap-lock.ts` — provable
  acquisition, classified failures, bounded wait), the drain gate's ready/wedged/legacy trichotomy
  with typed-absence legacy detection, provisioning rollback (deletes only what the call created),
  name-keyed client serialization, the capability seam (`packages/wire/src/capabilities.ts` —
  additive, typed-absence, uncoupled from protocol version; the model for how the lifecycle record
  should version), and `PlacementController.move`'s commit-under-failure CAS handling.

### 2.2 Codebase design — module boundaries

(Deep-module vocabulary: a module is deep when much behavior sits behind a small interface; the
deletion test asks whether deleting it makes complexity vanish or reappear across callers.)

- **[structural] `packages/harness/src/cloud/` is a bag, not a module.** ~110 live files, ~11,200
  LOC (after excluding deletion-marked relocation/portable/context-archive code), one flat
  directory, one 34-line `export *` barrel (`cloud/index.ts`), no sub-boundaries. Six latent
  modules are discernible — REST clients, channel, remote port adapters, local mirror, sandbox
  control plane, account sync — but nothing in the filesystem says so. Slice 07 and slice 08 both
  land here; "what belongs to relocation" is only knowable by import tracing, which makes the
  deletion harder to scope than it should be.
- **[structural] `remote-delta-channel.ts` is the hub god-object**: 985 LOC (3.3× the repo's own
  300-line cap — the worst violation in the tree), a ~30-method interface
  (`remote-delta-channel.ts:90-138`), 18 factory params (`:171-214`), 13 sibling importers. Three
  concerns in one file: socket retry/backoff, a 12-registry listener fan-out (`:227-241`), and the
  park/wake/reattach control plane. It is the file every cloud feature touches. (Flagged
  independently by both the lifecycle and reconnection audits.)
- **[structural] The new model inherits relocation coupling at two seams.** The surviving bridge
  code imports its interface types (`CloudBridge`/`CloudSandboxes`) from
  `relocation/cloud-bridge.ts` (`local-cloud-bridge.ts:6-11`, `local-cloud-attachment.ts:11`,
  `local-cloud-bootstrap.ts`), and the composition root itself imports `holdFamilyIntake` from
  `cloud/relocation/freeze-family` (`packages/harness/src/composition/compose-session.ts:5` —
  verified). Slice 08's premise "nothing live depends on it" is false as written; the deletion has
  a small prerequisite extraction. **[slice-08 scope]**
- **[structural] Born-placed birth *is* `liftToCloud` with `started: false`.**
  `apps/tui/src/composition/use-thread-birth.ts:78` drives the relocation engine's lift with
  `capture: null` short-circuits — provisioning, overlay progress, cancel-to-host, and `markBorn`
  sequencing all ride on the engine being deleted. Slice 08 must extract a `birthInCloud` from
  lift's ribs before deleting the body, or birth dies with it. This is the single largest hidden
  dependency on the to-be-deleted code. **[slice-08 scope]**
- **[structural] `HarnessApp` is a god-object-by-type** (~45 members,
  `packages/harness/src/composition/harness-app.ts:82-142`), mirrored serve-side by `ServeApp` and
  the ~20-optional-handle `createRequestRouter` arg bag (`apps/serve/src/socket-requests.ts:41-62`).
  Each member is a thin delegation — the depth failure is diffuse, not acute — but the interface a
  surface author must learn grows monotonically with every feature.
- **[worth-fixing] The #6 manifests are `Partial<>`.** `port-bindings.ts:49,64` declare
  `satisfies Partial<ComposedPortBindings>`; the full-type requirement bites only at the
  `composeHarness` call sites. Adding a registry key *does* break both apps' typecheck (as #6
  requires — verified), but the first error surfaces diffusely at every call site rather than
  once, naming the manifest. Also verified consistent with #6's "compile-time only": the `ports`
  value is never read at runtime.
- **[worth-fixing] `cloud-transport.ts` leaks retry/error policy into callers** —
  `isCloudUnavailable`/`isCloudRefusal` plus four exported retry constants mean every client
  author must learn the classification rules. Interface carries the callee's error model.
- **[worth-fixing] api redeclares wire's sandbox constants and helpers** —
  `apps/api/src/api/platform/sandboxes/vercel-sandbox.client.ts:8-9` redefines
  `SANDBOX_REGION`/`SANDBOX_SERVE_PORT` (wire: `sandbox-sdk.ts:7-8`) and re-implements
  `stateOf`/`routedUrlOf`/`SandboxMissingError`. The "api imports wire only" rule holds formally
  (8 import sites, enforced by `architecture.spec.ts` with a burn-down grandfather list —
  exemplary enforcement) but leaks substantively.
- **[worth-fixing] Sync engine port drift**: `UserLayerSyncEngine.reconcileNow` is public but off
  the port (`user-layer-sync/engine.ts:43` vs `port.ts`), and `UserLayerSyncClient` is a `Pick<>`
  of a concrete sibling class (`client.ts:3-6`) — the engine's contract is defined by another
  module's class shape.
- **[worth-fixing] `packages/wire` is two packages in one**: a decision-free zod contract half
  (healthy) plus a ~1,050-LOC sandbox-boot operational toolkit (drive lifecycle, serve
  install/launch, swap lock). Two real consumers make the seam real, but the package name lies
  about what it holds; the boot half is behavior, not contract.
- **[fine] The remote-* port adapters are the strongest boundary in the stack** — one adapter per
  registered port, write-refusal encoded in the adapter (`remote-event-log.ts:36-40`), consumers
  narrowing via `Pick<>` (`mirrored-event-log.ts:20-23`). The mirror machinery
  (`mirrored-event-log.ts` + `mirror-writer.ts` + `transcript-syncer.ts`) is deep and well-shaped;
  slice 07 correctly extends this pattern.
- **[fine] `user-layer-sync/` is the best-shaped module in scope** — 912 LOC, 19 files, a
  3-method port, pure decisions in core, no per-tree branches in the engine. What the rest of
  `cloud/` should look like.
- **[fine] `apps/serve` holds little feature knowledge** — `compose-serve.ts` is a thin adapter;
  the 300-line-cap violations cluster elsewhere (`compose.ts` 378, `cloud-transport.ts` 364,
  `sessions-client.ts` 358, `placement-controller.ts` 332, `vercel-driver.ts` 322,
  `socket-session.ts` 312, `resume-probe.ts` 311).

### 2.3 Skills

- **[structural] The serve-side sync engine never starts, so a born-cloud session boots
  skill-blind.** Two compounding gaps, both verified:
  (a) `start()` is gated on `markActiveThread` (`compose.ts:302-304`), whose only call site is the
  TUI (`apps/tui/src/composition/use-conversation.ts:107`) — nothing in `apps/serve` calls it, so
  a cloud session never pulls the user layer at boot or wake;
  (b) even if started, the skill registry's one `reload()` runs at compose
  (`compose.ts:186-189`), *before* any pull could land, and no serve-side reload trigger exists
  (only the TUI's `/skills` command). The files wouldn't be pulled; if they were, the roster
  wouldn't see them. Decision #5's "boot/wake pulls latest" is false on the surface it was written
  for. (A third suspected gap — serve possibly binding `NullUserLayerSync` because `cloud.json`
  may never reach the drive — is unverified end-to-end; see "open questions" in §4.)
- **[structural] Two delivery mechanisms for the user layer remain live in shape.** The archive's
  capture side is already gutted to `mcp.json`-only (`context-archive-policy.ts:31`), but the
  whole serve-side materialize stack (`materialize-context.ts`, `context-sources.ts`,
  `context-entries.ts`, `context-stamp.ts`, `context-archive-retry.ts`) is still boot-path code,
  and descend still round-trips memory as a tar (`serve-session-archive.ts:56` →
  `relocation/descend-transfer.ts:63`). The `context.stamp` short-circuit
  (`materialize-context.ts:22-25`) is a latent hazard: deleting the archive path without deleting
  stamp handling means a leftover stamp silently suppresses whatever replaces it. **[slice-08
  scope]** — slice 08's stated scope names "relocation/, descend/serve materialize paths,
  portable-state transfer plumbing"; the context-archive quartet is not named and needs an
  explicit line item.
- **[structural] The instructions tree syncs almost nothing**: `<atlasHome>/ATLAS.md` and
  `<project>/*.local.md` only (`tree-instructions.ts:19-30`). User agent types
  (`<atlasHome>/agents/*.md`) and user `CLAUDE.md`-family files do not sync — a cloud-born session
  silently lacks the operator's custom agent types. Decision #3 names domains, not files, so this
  is flagged for a decision rather than asserted as a contradiction.
- **[worth-fixing] Multi-file skill atomicity is per-file only.** Temp+rename per write, per-file
  revision LWW, no directory generation — a crash mid-pull leaves a mixed-revision skill directory
  (converges on the next pull). Consistent with #3's per-file decision; name it as accepted, and
  revisit only if mid-session pull ships (the boot window is accidentally shielded by the registry
  gap above).
- **[worth-fixing] Stale prose** describes a skills/memory tar that no longer exists: the
  `"uploading skills and memory"` transfer label (`local-cloud-bridge.ts:140`), the `captureContext`
  doc-comment, and architecture.md's compat skill-import recovery paragraph
  (`docs/architecture.md:1538-1552`), which has no implementation outside one spec.
- **[fine] Location-agnostic execution is genuine**: serve passes `userSkillHome: atlasDirectory()`
  with `ATLAS_HOME=/atlas/home` (`compose-serve.ts:84-85`, `sandbox-mount.ts:80`), so discovery
  (`skillRootPlan`), sync scanning, and execution all point at the same drive-backed roots — the
  synced set and the discovered set cannot drift apart by construction. Serve composes the same
  registry, fragment, and `skill` tool.
- **[fine] The API storage side is solid**: path hygiene, server-side sha256 verification,
  `updateMany` CAS with unique-violation fallback, per-user scoping in the unique key, and the
  `SessionOrSandboxGuard + @SandboxReachable` convention. The SSE fanout + `sinceRevision` delta
  listing shipped with no client consumer — remote changes are learned only at boot pull or on a
  local edit.

### 2.4 Memory

- **Verdict on the operator's named question — watcher seam vs write seam: keep the watcher.**
  The writers of memory files are: (1) the model's file tools (atomic temp+rename via
  `files/atomic-write.ts:28-50`), (2) the model's `bash` — no path interception possible by design
  (architecture.md:1247-1249), (3) the operator's editor, inside or outside Atlas, (4) the sync
  engine's own apply, (5) legacy adoption at compose. A write seam covers (1) and (4) only, so it
  would still need the scan fallback — and the scan-vs-state hash diff already exists and *is* the
  correctness mechanism; the watcher is a latency hint over it. Echo loops are structurally
  impossible (`applying`/`missedWhileApplying`, `engine.ts:69-109`, plus the hash short-circuit in
  `push.ts:18`). Conflict copies and `.atlas-partial` temp files are excluded from scan, watch,
  and apply on both ends. The seam choice is right; the gaps are elsewhere.
- **[structural] The serve-side engine never starts** — the same finding as 2.3's first item,
  with the memory-specific consequence: memory written inside a cloud session reaches other
  devices only via descend, which #13 deletes. Fix the start seam before slice 08, or greenfield
  cloud threads have no memory delivery at all.
- **[worth-fixing] No clock anywhere — and that's better than the decision text.** Decision #3's
  "LWW" is implemented as server-revision CAS, prefer-remote on pull, pull-then-retry on push; no
  wall clock is consulted. Strictly better than the letter of the decision; the section doc should
  say so.
- **[worth-fixing] `MEMORY.md` union-merge keys exactly on the real `- [Title](file.md)` format**
  (`packages/core/src/user-layer/memory-index-merge.ts:13`) but drops blank lines and appends the
  losing side's new entries at end-of-file regardless of `##` section — functionally fine (the
  model reads the index flat), cosmetically lossy across successive merges.
- **[worth-fixing] Silent watcher death**: `watcher.ts:52` swallows errors with no log line and no
  periodic fallback pass — pushes silently stop until process restart. Decision #5's "silent" is a
  UI constraint, not a license to lose correctness quietly.
- **[worth-fixing] Non-atomic bash writes can sync torn** — `cat > memory.md` hashed mid-write;
  the tear replicates cleanly (contentHash matches the torn bytes). Bounded by the 500 ms
  debounce; low probability.
- **[fine] Offline edits are caught** (boot runs pull+reconcile before watching); create-vs-delete
  resolves without data loss (a remote tombstone never deletes a never-synced local file —
  `apply.ts:47-53`); project-memory keying travels correctly (origin-identity keying derives the
  same directory on both surfaces).

### 2.5 Session reconnections

- **[structural] Five reconnect entry points, one destination.** Socket backoff retries,
  early lifecycle-verdict escalation, post-exhaustion escalation, `kickWake` (with its own
  identical-signature failure counter), and manual `reconnect()` — plus the TUI wake lane — all
  converge on `probeSandboxForResume`, each carrying its own budget, generation guard, and Closed
  wording (`remote-delta-channel.ts:677-948`). Generation fences are correct everywhere checked,
  but two of the five are the same decision duplicated at different points in the same retry
  cycle, and `reconnect()` re-implements escalation a third time with a subtly different
  precondition. This is where the next wedge bug will live — and slice 05d (warm pool) adds a
  sixth entry point (pool claim) that this file cannot absorb safely as-is.
- **[structural] Retry/timeout policy lives at nine sites with no shared vocabulary** — channel
  backoff, upstream deadlines, the request-timeout table, keepalive, the SSE lane's own
  backoff+watchdog+heartbeat, API transport, drain/swap-lock, driver timeouts, checkpoint mirror.
  Several constants are pinned to external facts with excellent comments (the 340 s Vercel edge
  kill); those stay at their sites. But "how long until the operator sees a failure" requires
  summing across sites, and the numbers were never chosen to compose. `DEFAULT_REQUEST_TIMEOUT_MS`
  is defined twice (`request-timeout.ts:3`, `cloud-transport.ts:37`) as unrelated constants.
- **[structural] Decision #4 is honored for exactly one file today.** The root event log has the
  full current-by-construction treatment (serve-only writer, three correctly-layered staleness
  deciders, remote-wins-no-merge). Child transcripts, thread metas, ledger, and context files are
  remote-read-on-demand; `MirroredContextFiles` is a full-tree re-pull cache with a client-side
  counter, no divergence detection, and no deletion propagation — precisely the
  cache-with-invalidation-holes shape #4 rejected. **[slice-07]** — D2/D4/D5 close exactly this,
  faithfully; the review's point is only that #4 is aspirational until 07 lands.
- **[worth-fixing] Greet accretion**: `Ready` carries five optional fields with independent
  presence semantics, plus dual checkpoint-tolerance paths (a schema `.catch(null)` and a bespoke
  salvage parser, `remote-delta-channel.ts:285-297`). Client `capabilities` on `Hello` are sent
  and never read serve-side. Slice 07 chose a protocol bump (22→23) for two additive read ops —
  arguably the accretion the capability enum was built to avoid; flagged for 07's builder, not a
  defect in the locked design.
- **[worth-fixing] Slice-07's mirror revision is serve-memory-only per boot** — every
  park/wake/hot-swap forces a full manifest walk + sha256. A drive-persisted stamp would give the
  file mirror the cross-boot short-circuit the transcript vouch already has. **[slice-07 gap]** —
  raise with 07's builder before the design freezes further.
- **[worth-fixing] The freshness fold re-derives channel semantics per consumer** —
  `vouched`/`dirty`/`holding`/`everOpen` in `apps/tui/src/composition/cloud/cloud-session.ts`;
  `holding` exists because two state machines disagree about whether a deliberate disconnect is
  staleness. Slice 07 adds a fourth dimension into the same fold; promote it to a pure core
  function before that lands.
- **[worth-fixing] Interrupt can be silently dropped on a dying socket** (`:304-317` — the 5 s
  ack timer bails if the channel isn't Open; re-send on Ready only if `turnInFlight`). The durable
  outcome is correct; the operator gets no feedback. Minor.
- **[fine] Mid-turn disconnect and park-during-stream are solid** — serve preserves execution on
  transport loss, turn waiters settle on `Ready.turnInFlight`, park is structurally impossible
  mid-work and clean when idle (Parked frame + 1001 + sealed checkpoint). Protocol fencing is
  three layers deep (probe stamp, greet refusal, Ready check) and each layer is right.

### 2.6 State management

State-ownership summary (full table in the state report):

| State kind | Authority | Shadows | Survives |
| --- | --- | --- | --- |
| Event log | serve's drive JSONL (client writes rejected, `mirrored-event-log.ts:53`) | local mirror; serve frame buffer; **API DB `Thread`/`Event`/`Turn`** | drive: park/wake/recreation |
| Runtime checkpoint | serve (`runtime-checkpoint.ts:42`), monotone revision | drive file; API column; socket broadcast; TUI `parkedTranscript` thread meta | drive copy: everything but drive delete |
| Placement | owning thread store, CAS (`placement-controller.ts:252`) | controller Map; serve hydration writes; API `executionLocation` string; `location-changed` events | thread meta on owning side |
| Sandbox row | nobody singly — API `state` reconciled by convention against checkpoint phase + Vercel inspect | three encodings plus channel state | API row: sandbox recreation |
| Rotation receipt | serve, drive, sealed once, fenced by sessionId | none — the model citizen | the recreation it describes |
| Sync cursors | per-device `user-layer-sync.json`; server `UserFile` rows | — | drive (serve) / local disk (TUI) |

- **[structural] The API DB session tables are a permanent stale twin of the log.**
  `Thread`/`Event`/`Turn` (`apps/api/prisma/schema.prisma:36-110`) are written by the owner client
  over REST while connected, read back by `cloudListing` — and go stale the moment the client
  disconnects while serve keeps turning. Decision #4 scopes "session data" to the
  sandbox↔rendering-client mirror and is silent on the API DB. Greenfield is the moment to declare
  these tables a non-authoritative listing projection (with a freshness bound) or delete the
  append path; write-through from serve would be the drift architecture.md's "one record" rule
  exists to prevent. (Whether anything live still calls the append endpoints is unconfirmed — no
  non-spec caller found; one confirmation before deleting.)
- **[structural] Sandbox lifecycle state has four encodings reconciled by convention** — API
  `state` string (no ordering discipline, transitions scattered across claim/register/park/wake),
  checkpoint `phase` (revisioned, serve-written), Vercel inspect (live truth), channel state. The
  API knows its row is a claim — `status()` overlays a live inspect — but `list()` serves the raw
  row. The checkpoint already carries phase with a monotone revision straight from the runtime;
  the string column beside it has no discipline at all.
- **[structural] Placement truth for a cloud thread exists only on the drive**, while the API's
  `Thread.executionLocation` is an unrevisioned string written by `PATCH /v1/threads/:id/location`
  (`threads.service.ts:216-226`) that never hears about conflicts — a third store with a third
  discipline (raw overwrite), beside CAS+revision and the append-only `location-changed` events.
  **[slice-08]** — the endpoint is lift/descend-era machinery; delete it, don't guard it.
- **[worth-fixing] Four copies of the checkpoint digest** — drive file, API mirror column, socket
  broadcast, TUI thread meta (`parkedTranscript`, earned by a best-effort race with a 5 s timeout,
  `park-persistence.ts:67-87`). Keep the checkpoint (it is a signed *summary* of the log, not a
  second record of position — log-is-authoritative done right); kill or justify each replica.
- **[worth-fixing] `CloudSandbox.lastActivityAt` is written only at lifecycle transitions, never
  by live activity** — yet the subscription sweeper's `liveUntil` adds a 24 h window to it
  (`github-delivery-routing.ts:16-38`). The name lies; the sweeper's idea of "active" can be days
  stale.
- **[worth-fixing] Three revision/cursor disciplines where one pattern would do** — placement CAS
  (controller-computed `max(prior, published)+1`), checkpoint (self-increment + write-refusal),
  user files (`baseRevision+1` + 409 conflict copies), plus the log's `seq` and the transcript
  digest as fourth/fifth orderings. Individually sound; never stated as one pattern. Slice 07's
  mirror revision is about to become the fourth ad-hoc instance.
- **[fine] Log-is-authoritative holds inside the runtime boundary** — no checkpoint of loop
  position exists anywhere; the checkpoint stores transcript *identity* (head/count/digest) and
  phase, never resumable state. The "one record" rule is honored. Mirror discipline is mechanical,
  not aspirational (rejected client writes, digest-verified repair, head-extension enforcement).
  The rotation receipt is the model citizen: single store, sealed once, fenced by sandboxSessionId,
  deleted only when consumed.

---

## 3. Contradictions of locked decisions

These are the findings that matter most; each names the decision it contradicts.

1. **#5 — "Boot/wake pulls latest" is false on the cloud surface.** The sync engine starts only
   from `markActiveThread`, called only by the TUI (`compose.ts:302-304` →
   `use-conversation.ts:107`). Serve never starts it, so a born-placed cloud session — the default
   placement under #13 — never pulls skills, instructions, or memory at boot or wake, and never
   pushes memory its agent writes. Compounded by the registry ordering (the one `reload()` runs
   before any pull could land) and possibly by a missing `cloud.json` on the drive (unverified).
   **This must be fixed before slice 08**, or #13's "sync IS the delivery" deletes the only
   remaining cloud delivery path (the descend memory tar) while its replacement is inert.
2. **#13 — "the relocation engine is deleted EARLY … nothing live depends on it"** is false as
   written. Live dependencies on the deletion-marked subtree: born-placed birth *is*
   `liftToCloud({ started: false })` (`use-thread-birth.ts:78`); the composition root imports
   `holdFamilyIntake` from `relocation/freeze-family` (`compose-session.ts:5`); the surviving
   bridge's interface types live in `relocation/cloud-bridge.ts`; and the placement move engine
   (`PlacementController.move`/`recover`, `EPlacementMovePhase`, `born?: boolean | null` at
   `packages/core/src/execution/placement.ts:33-37` — the marker #13 explicitly killed, with its
   grandfathering doc comment) sits in composition, **outside** slice 08's stated scope. The
   context-archive quartet (`materialize-context`/`context-sources`/`context-entries`/
   `context-stamp`/`context-archive-retry`) is likewise unnamed in the scope. Slice 08 needs
   either a wider scope or a preceding seam-extraction slice.
3. **#7/#13 — placement immutability has two unsupervised writers.** Serve's
   `placement-hydration.ts:62-77` rewrites placement for the root and every child on every boot,
   inferring "should be cloud" from heuristics, around the controller it just read from. The API's
   `PATCH .../location` mutates `executionLocation` as a free string. Neither passes
   `PlacementController.validate`, the only place the `born` guard lives. Both predate #7 and both
   are relocation-era — the fix under #13 is deletion (no writer, structural immutability), not
   more guards — but slice 08's scope names neither.
4. **#4 — "one-to-one mirror … current by construction" is true of exactly one file today** (the
   root event log). `MirroredContextFiles` is the cache-with-invalidation-holes shape #4 rejected;
   child transcripts, metas, and the ledger have no mirror. **Already addressed by slice 07's
   locked design** — no action beyond landing 07, but the review record should not describe #4 as
   true of today's tree.
5. **#3 — the instructions sync domain is much narrower than the decision's plain reading**:
   `ATLAS.md` + `*.local.md` only; user agent types and user `CLAUDE.md`-family files do not sync.
   The decision names domains, not files, so this needs one line from the operator (in scope or
   explicitly out), not a code assertion.
6. **Doc drift (cheap, but the docs are the stated source of truth):**
   `docs/architecture.md:1420` still says "Memory is not a synced domain" — reversed by #3 and by
   shipped code; the persistent-skill compat-recovery paragraph (`architecture.md:1538-1552`)
   documents behavior with no implementation; `"uploading skills and memory"`
   (`local-cloud-bridge.ts:140`) labels an archive that now contains only `mcp.json`.

Not contradicted, verified: **#1** (hot-swap intact and hardened post-phase-1), **#6** (the
compile gate genuinely breaks both apps' typecheck on a missing binding — with the `Partial<>`
manifest nuance noted in 2.2), **#9/#11/#12** (the chooser, blocking-cancellable overlay with real
progress, and pre-send flip-back with draft are implemented as locked), **#2's superseded
grandfathering** survives only in the places #13 already marked for deletion.

---

## 4. Prioritized revamps

Bigger than fixes, in priority order. Payoff and cost are rough (small ≈ a day, medium ≈ days,
large ≈ a slice). Each is checked against the locked decisions.

**R1. Fix the serve-side sync engine before anything else is deleted.** Start the engine from
serve boot (not `markActiveThread`), resolve the `cloud.json`/`ServeSessionToken` binding
question, and reload the skill registry after the boot pull. *Payoff:* makes #5 true on the
default surface; unblocks #13's archive/descend deletion; without it, greenfield cloud threads
have no user-layer delivery at all. *Cost:* small-medium — the credential-seam decision is the
real work. *Decisions:* respects #3/#5/#13; no reopens. This is a fix to slice 06's reach more
than a revamp, but it gates 08, so it leads the list.

**R2. One lifecycle record, one state machine, one owner.** Promote the sandbox lifecycle to a
single durable record — one file on the drive, or a column family in the checkpoint — with a real
enum (`Provisioning → Serving → Draining → Drained(receipt) → Parked → Replacing`), written by
serve at the transitions it owns (drain seal, park finalize) and by the driver at its own
(provision, swap). `probeSandboxForResume`, the drain gate's wedge/legacy proofs, and boot
recovery become reads of the record instead of inference over stamps + health + receipts. The
rotation receipt survives as the *payload* of the Drained state (its sessionId fence is genuinely
good). The API's `CloudSandbox.state` column becomes a read-time derivation from the mirrored
checkpoint, deleting the four-encodings-reconciled-by-convention problem (2.6). *Payoff:* high —
the five phase-1 defects were all inference-edge bugs; this deletes the graph they lived in, and
it is the substrate the warm pool (#10) will need, since a standing sandbox lives permanently in
exactly this machinery. *Cost:* medium — a schema, writers at the six existing transition points,
and deletion of the inference edges; greenfield means no compat window is owed. *Decisions:*
respects #1 (hot-swap stays — the swap becomes a state transition, not a protocol archaeology
dig), enables #10, embodies #13.

**R3. Make birth a first-class harness operation, and cut the relocation engine loose.**
Extract `birthInCloud({ threadId, placement })` — provision, bootstrap write, authorize, attach,
`placeAtCreation`/`markBorn`, overlay progress, cancel-to-host — from `liftToCloud`'s ribs; move
`CloudBridge`/`CloudSandboxes` and `holdFamilyIntake` out of `relocation/`; then delete the
engine, *including* the placement move machinery in composition (`move()`/`recover()`/
`PlacementTransaction`, the `born?: null` marker, `EPlacementMoveKind.Lift/Descend`), serve's
placement hydration, and the API's `PATCH /location`. *Payoff:* high for #13 execution — turns
"immutable at creation" from a guarded convention into the absence of any writer, and unblocks 08
honestly. *Cost:* medium — mostly deletion plus the birth extraction; the extraction is
prerequisite, not optional. *Decisions:* this is #13 implemented fully; it extends slice 08's
stated scope (move engine, hydration, location endpoint, context-archive quartet), which the plan
should record.

**R4. Split the delta channel and make the reconnect ladder an explicit state machine.**
`remote-delta-channel.ts` becomes socket-lifecycle / frame-fanout / wake-park-control behind the
unchanged `RemoteDeltaChannel` type; the five reconnect entry points become named states and
transitions with one budget, one generation fence, one Closed vocabulary. *Payoff:* the file
every cloud feature touches becomes reviewable; the 2026-10-09 wedge class of bugs lived exactly
here; slice 05d's pool claim cannot be safely added to the current shape. *Cost:* medium — the
file is already fully injectable, so the rewrite runs against the existing spec suite. *Decisions:*
respects all; none reopened.

**R5. Move serve's lifecycle ceremonies into harness as a registered port.** A
`SessionLifecyclePort` — runtime binding owned by harness (park ceremony, drain ceremony), the
`/v1/park` + `/v1/drain` endpoints as its transport slot — pulls the policy out of the transport
app, fixes the parked-marker hand-publish (as harness publishing coverage), and makes the
ceremonies composable into any surface. *Payoff:* medium-high — the last feature-policy islands
in serve come under the #6 contract; the strata become honestly drawn. *Cost:* medium. *Decisions:*
implements #6's spirit where the letter doesn't reach; respects #1.

**R6. Declare what the API's session tables are, then enforce it.** Either (a) declare
`Thread`/`Event`/`Turn` a non-authoritative listing projection with a stated freshness bound and
delete the append path, or (b) serve write-through. (a) is the decision-consistent option — (b) is
a second writer to the log's facts, the drift the one-record rule exists to prevent. One
confirmation first: whether any live caller still appends (none found outside specs). *Payoff:*
removes the one surface (`/resume` listing) that reads state nobody keeps fresh. *Cost:*
small-medium for (a). *Decisions:* extends #4's authority story to the API tier — arguably a
decision to record, not one to reopen.

**R7. Give `harness/src/cloud/` internal module boundaries.** Six sub-directories with their own
entry points (client / channel / remote-ports / mirror / sandbox / account-sync) replacing the
flat `export *` barrel. *Payoff:* slice 08's deletion becomes a directory listing instead of an
import trace; the sync/mirror additions get named homes; the next reviewer starts from the map,
not the archaeology. *Cost:* low-medium — mechanical import churn. Do it *before* or *as part of*
R3's deletion, not after.

**R8. Consume the sync SSE fanout (or `sinceRevision` on a timer).** The API already ships
per-mutation fanout with heartbeats; wiring it turns "pull at boot" into live convergence, which
is the Dropbox shape #3 describes. Note the fanout is per-replica in-memory — fine at one API
replica, silently wrong at two; say which is true of the deployment. *Payoff:* medium — mid-session
skill/memory propagation without restarts. *Cost:* medium (reconnect/backoff is the real work;
half-cost variant: `sinceRevision` polling). *Decisions:* implements #3's shape; respects #5
(silent).

**R9. One stated revision/CAS pattern.** A short section in `docs/core-contract.md` (or a small
core helper) naming the shape — monotone integer + store-side CAS + conflict surfaced as value —
so slice 07's mirror revision is the first standard instance rather than the fourth ad-hoc one.
*Payoff:* review surface shrinks; the pattern is already proven three times. *Cost:* small.

**R10. Write the survival invariant.** One paragraph in architecture.md: the drive survives
park/wake/recreation (workspace, logs, metas, receipts, sync cursors); the API DB survives sandbox
loss (identity, tokens, subscriptions, checkpoint mirror, user files); local disk survives client
restart (mirror, parkedTranscript, cursors); the sandbox runtime filesystem survives nothing. Plus
the doc-drift fixes (2.6 of contradictions). *Payoff:* half this audit's questions would have been
answered from the doc. *Cost:* trivial.

**Deferred deliberately (with reasons):**

- **Shrink `HarnessApp`** (group the ~45 members into feature handles): real but high-churn across
  both surfaces; revisit after phase 2. *Direction noted, not recommended now.*
- **Skill-level sync generations** (atomic multi-file skill updates): high cost relative to payoff
  while pulls converge and the boot window is shielded; revisit only if R8 ships and half-applied
  skills become observable.
- **amp-style server-owned user layer** (the cloud fetches a hosted user document; research §5.3):
  a genuinely different model from #3's device-sync. Not recommended — #3 is locked, shipped, and
  well-shaped; but record the trade it accepted: the local laptop is the permanent availability
  dependency for user-layer freshness, which R8 partially mitigates.
- **amp-style spawn pacing instead of a warm pool** (burst + interval + queue, server-side;
  research §5.2): the cheap alternative to #10's standing sandboxes. #10 is already deferred until
  the lifecycle proves out; if R2 lands, revisit whether a pacing queue answers the cold-start
  problem without a pool that lives permanently in the park/wake/swap machinery. *This is the one
  place the review suggests a decision may eventually deserve reopening — not now.*

**Open questions the audits could not close** (each cheap to answer, each gates a revamp):

1. Does `cloud.json` reach the sandbox drive on any live path? (Gates R1's binding half; no
   writer found — needs one live check.)
2. Does anything in production call the API's event/turn append endpoints for cloud threads?
   (Gates R6's deletion half; no non-spec caller found.)
3. Is the API a single replica? (Determines whether R8's fanout is correct or silently wrong.)
4. Instructions domain boundary: are user agent types and user `CLAUDE.md`-family files in scope
   for #3? (One line in decisions.md either way.)
5. For slice 07's builder: persist the mirror manifest stamp on the drive so the revision
   survives park/wake/hot-swap (the transcript vouch already solved this cross-boot).
