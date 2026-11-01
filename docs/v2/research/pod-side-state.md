# Pod-side state census

Part of the evidence for [v2](../README.md). A condensed transcription of a read-only exploration
of the repository at commit `a18e7413` (2026-11-01). The original listed 92 grouped store families
with full anchors; this is a lower bound, not an exhaustive per-reader/writer census (see
[Coverage gaps](#coverage-gaps)). Statements marked _(inferred)_ are conclusions, not observations.

Anchor roots: **C**=`packages/core/src`, **H**=`packages/harness/src`, **S**=`apps/serve/src`,
**T**=`apps/tui/src`, **A**=`apps/api/src`. HOME is the resolved Atlas home
(`H/store/paths.ts:32-37`); SESSION is `HOME/sessions/<sid>`; THREAD is `SESSION/threads/<tid>`.
Origin tags: **V** in-process-born (no distributed ownership protocol), **P** pod-aware, **M**
shared v1 with pod-aware wrapping.

## Headline findings

- The pod and the API allocate conversation seqs independently. The flusher has no append-fork
  recovery ([incident](incident-2026-11-01-seq466.md)).
- **Replication drops event identity.** `H/cloud/pod-event.ts:6-20` strips the pod event id and the
  API mints a new one (`A/api/platform/sandboxes/pod-events.ts:70-85`). The transcript identity
  digest is `[id, seq, type]` (`C/events/event-identity.ts:112-124`), so the pod log and the
  Postgres replica are never identity-equal even when contents match. There are three equality
  notions: API idempotency (content, no id: `pod-events.ts:20-28`), host pod-copy (id:
  `H/pod-thread/local-copy.ts:30-35`) and checkpoint digest (id + seq + type).
- **Hydration never checks the overlapping prefix.** `S/serve-hydrate.ts:44-50` imports only rows
  with seq > local head, so a divergent overlapping row is silently skipped. The mirror writer's
  `appendFrom` does the same (`H/cloud/mirror-writer.ts:111-116`).
- **Rebase interception is narrow.** `S/serve-history-mirror.ts:33-55` wraps only `rewind.truncate`,
  `compaction.summarise` and `compaction.compact`. Loop-cut
  (`H/store/sessions/ops/cut-loop.ts:36-65`) truncates and re-appends with new seqs and bypasses it
  _(inferred: a second fork path)_.
- **Several head records are read as authority.** `SessionRegistry` uses `max(parsed.head,
meta.head)`, so metadata participates in allocation.
- **Session meta is a stale second copy.** `H/store/sessions/session-meta.ts:49-64` preserves old
  worktree, PR and spend values instead of refolding them. That explains `pullRequests: null` in
  the incident.
- Title and model each have pod, API and host copies with fire-and-forget forwarding
  (`S/serve-rename-forward.ts:17-24`, `S/serve-thread-model-persist.ts:23-33`,
  `H/pod-thread/rename-mirror.ts:3-9`).

## Five riskiest ownership seams

1. Concurrent API and pod event allocation. A 409 freezes the flusher cursor forever.
2. History rewrites (loop-cut) that bypass `mirrorHistoryEdits` and rebase.
3. Several head and metadata records coexist: JSONL head, thread meta head, session meta, API
   `Thread.head`, host copies, checkpoint head.
4. Serve rewrites whole cloud-materialized vault, settings and secrets files while harness code
   mutates the same files. `writeVault` bypasses the AccountStore vault lock (`S/cloud-state.ts:52-73`
   vs `H/credentials/account-store.ts`). _(Inferred: lost token refreshes.)_
5. The context directory is replicated with incompatible delete semantics. The serve → API mirror
   deletes missing files (`S/context-files-mirror.ts:40-64`); the host mirror is additive
   (`H/cloud/mirrored-context-files.ts:192-202`). There is no shared revision protocol.

## Conversation-seq allocators (every site found)

| Site                                               | Rule                                                                            | Coordination                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------ |
| `H/store/sessions/event-log.ts:174-185`            | head + 1 + index                                                                | in-process `SessionRegistry` queue, no API fence |
| `H/store/sessions/ops/log-edits.ts:106-120`        | head + 1 + index (loop-cut)                                                     | session queue                                    |
| `H/store/sessions/thread-store-history.ts:87-103`  | compaction watermark reuses a vacated seq or head + 1                           | session queue                                    |
| `H/store/sessions/event-log.ts:230-240`            | replacement: fork floor + index + 1                                             | session queue                                    |
| `A/api/platform/sessions/append.ts:177-199`        | reserve a batch by bumping `Thread.head` (`thread-head.ts:10-32`, `FOR UPDATE`) | Postgres transaction, independent of the pod     |
| `A/api/platform/sessions/events.service.ts:97-118` | API replacement: index + 1, head = row count                                    | Postgres transaction                             |

Not a conversation seq: `S/frame-buffer.ts:43-47` (a transport replay counter).

Sequence-preserving (non-allocating) paths: `H/store/sessions/thread-places.ts:148-204`,
`H/cloud/mirror-writer.ts:76-145`, `S/serve-hydrate.ts:48-81`,
`T/composition/cloud/local-transcript-files.ts:70-93`, `A/api/platform/sandboxes/pod-events.ts:54-94`,
rewind truncation (`ops/log-edits.ts:48-85`).

Incident path: `ThreadMessagesService.send` → `appendAndClaim` → `appendUserSaid` →
`appendStoredWithin` → `advanceHead` → `Event.createAndCount`
(`A/api/cloud/sandbox-provisioning/thread-messages.service.ts:56-67,120-147`,
`thread-message-queue.ts:33-51`, `A/api/platform/sessions/append.ts:159-207`). The socket send goes
`S/socket-commands.ts:71-82` → `driver.say` → the local allocator.

## Append entry points

All delegate to the normal JSONL allocator unless noted.

- **Serve/TUI**: `S/turn-commit.ts:34`, `S/child-send.ts:49`, `S/workspace-hooks.ts:102`,
  `S/serve-resume-boot.ts:51`, `S/serve-boot-app.ts:133`, `S/serve-lifecycle.ts:115`,
  `S/container-notice-events.ts:37`, `T/composition/use-driven-turn.ts:69`,
  `T/composition/directory-move.ts:56`, `T/composition/live-cloud.ts:130`.
- **Loop**: `H/loop/run-turn.ts:203`, `tracked-turn.ts:86,269,275`, `resume-turn.ts:26`,
  `pending-intake.ts:45`, `dispatch-recovery.ts:41`, `settle-pending.ts:62,97`,
  `recorded-failures.ts:20`, `turn-faults.ts:86`, `close-quiet-step.ts:82,86`,
  `shell-completion.ts:21`, `tldr-turn-runner.ts:93`, `loop-watchdog.ts:177-221`.
- **Agents**: `H/agents/registry/agent-journal.ts:33`, `open-child.ts:47`, `say.ts:110,115`,
  `record-restart.ts:22`, `pending-endings.ts:31`, `pause-thread-children.ts:84`,
  `lost-children.ts:41`, `relocate-children.ts:120`.
- **Other**: `H/shells/journal.ts:232`, `H/services/service-journal.ts:113`,
  `H/services/recovery.ts:74`, `H/subscriptions/journal.ts:124`,
  `H/subscriptions/pr-event-journal.ts:49`, `H/operator-input/registry.ts:246`,
  `H/composition/flush-session-input.ts:16`, `session-teardown.ts:71`, `worktree-claims.ts:181`,
  `directory-move.ts:54`, `turn-policy-runner.ts:194`, `H/store/sessions/thread-store.ts:131`,
  `H/store/relocate-session.ts:42`, `H/store/rewind.ts:107`, `H/channel/dismiss-run-failure.ts:9`,
  `publishing-turn-runner.ts:34`.
- **Own allocator**: loop-cut (`cut-loop.ts:54,56` → `log-edits.ts:108-127`). **Stamped**:
  compaction (`thread-store-history.ts:98,106`).

## Store families (condensed; 92 in the original)

**Durable, file-backed (1–48)**

- Conversation JSONL `THREAD.events.jsonl`: local authority, but Postgres is a second writable
  record (M).
- `THREAD.meta.json` (title, head, ancestry, placement, …): mixed; head participates in
  allocation (M).
- `SESSION/meta.json`: authority for the active main thread plus stale copies of worktree, PR and
  spend (V/M).
- `ledger.jsonl` (spend, independent accounting), `logs.jsonl` (diagnostic), `SESSION/lock` (host
  PID claim, no API fence).
- `*.mirror.lock` cross-process exclusion. The normal append does not take it (P).
- `THREAD.read.json` read cursor; `SESSION/workspace-ownership.json` (world ownership, outside the
  log).
- `HOME/operational/runtime-checkpoint.json` (pod lifecycle plus API mirror; a revision, not an
  atomic CAS) (P).
- `bootstrap/workspace-spec.json`, `operational/workspace-dir.json`, the materialized repo and
  clone sentinel (P).
- `auth.json` vault (local authority, or a cloud-leased whole-file copy in serve), key, vault
  locks, `cloud.json`, `secrets.json`, `settings.json` files, `mcp.json` (the cloud merge never
  deletes removed entries), MCP OAuth state in secrets.
- Skills and instructions trees, embedded skill bundles, plugin type declarations (build-derived).
- `pull-request-badges.json`: GitHub observation cache, no lock on concurrent save (M).
- Image cache, upload materialization, quality examples, codex-models cache, user-layer sync
  ledger, `last-push.json`, `telemetry.json`, misc markers, resume journal.
- `SESSION/context/**`: runtime world state plus an API copy plus a host copy with different delete
  semantics (M).
- Durable shells: config/token, meta/status, `spool.out`, cursor (corrupt → resets → replays
  output), leases/cancel/socket.
- Service logs, pod SSH signing key and allowed signers, file mounts and git exclude, cloudflared
  state, TUI dev-serve cache, reaper failure marker, `SESSION/.postgres-upload.json` (stamps
  without prefix verification).

**In-memory registries and caches (49–82)**
`SessionRegistry` (the cached head drives allocation), place readers, settings service, cloud
settings / user-settings / account / secrets caches (optimistic overlays, deliberate divergence),
credential dedupe maps, memory index, read-before-write views, quality / web / model / usage
caches, MCP handle store, skill registry, tool and prompt registries, plugin projections, GitHub
`SessionFacts` and tracking, PR service readings and SSE book, `AgentRoster`, notice queues, child
steps and recovery, pending operator messages (not durable until appended), `MessageIntake`,
operator input, shell and service registries, journals and supervisor, `SubscriptionRegistry` and
delivery buffers, `PlacementController` / `SessionOwner` (expected revision, but no API writer
fence), `DeltaChannel`.

**Serve/TUI surface (83–92)**
Flusher durable cursor (not persisted, rebuilt at boot), context flush, checkpoint capture,
`FrameBuffer` (2048 frames, resets on restart), socket sessions and committed-send dedupe
(memory-only), turn driver latches, TUI `ConversationStore`, composer draft sync (failures
swallowed), TUI composition caches, diagnostics.

## Coverage gaps

- The 92 entries are grouped families, not every map, file or lock.
- Not every `apps/serve` module body was read. Transitive port consumers, `@dltech/atlas-client`
  channel state, all TUI hooks, Docker engine/terminal/exposure registries and the full settings
  and credential call graphs were not expanded.
- No live-state verification; repository reading only.
