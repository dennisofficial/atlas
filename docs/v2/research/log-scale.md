# Log-scale census: what v1 does with a 1,000,000-event thread

Part of the evidence for [v2](../README.md). A condensed transcription of a read-only static audit
of `main` at `f3d629e3`, 2026-11-02. Not a benchmark: costs are engineering estimates. Anchors are
`file:line` and may drift.

## Sizing

Transcripts in a real Atlas session averaged 1.5–5 KB per event, so 1M events is **1.5–5 GB per
thread**. Costs below use these labels:

| Label     | Work at 1M events                                     | Rough cost                                                    |
| --------- | ----------------------------------------------------- | ------------------------------------------------------------- |
| Scan      | One pass over cached events                           | 0.05–2 s per pass; the whole history stays resident           |
| Decode    | Read, split, JSON-parse and validate all of the bytes | 10–120+ s; peak memory several times the file (6–30+ GB)      |
| Send      | Serialize and transfer every event                    | 12–40 s on 1 Gbit/s before overhead; GB-scale strings         |
| Rewrite   | Decode, filter, restamp, encode, write                | Decode plus another 1.5–5 GB written                          |
| Quadratic | Repeated scans or copies of a growing subset          | Minutes to hours, or failure                                  |

## Verdict

v1 cannot run a 1M-event thread. Whole-log work sits in append, activity reads, every model step,
replication, checkpointing and client refresh, not only in opening history. **v1 uses the archive as
its state database**: current state (pending calls, worktree, subscriptions, contexts) is re-derived
by folding history from seq 0, again and again.

Engine limits fail before the heap does: whole histories are spread into function arguments
(`events.push(...all)` at `packages/harness/src/store/sessions/event-log.ts:109,262`,
`thread-places.ts:201`, `ops/log-edits.ts:82`) and joined into single strings.

## Top 10 offenders (frequency × cost)

| #   | Offender                                                     | Anchor                                                                                         | When                                    | Cost                         |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------- |
| 1   | Torn-tail check reads the whole file to test the last byte   | `packages/harness/src/store/sessions/lines.ts:63-77`, `event-log.ts:191-192`                  | Every append                            | B bytes read per append      |
| 2   | Serve pull hydrates with no `fromSeq`, then forces a reload  | `apps/serve/src/serve-hydrate.ts:43-50`, `serve-pull.ts:91-115`                                | Every stream tick and roster change     | Send + Decode, per child too |
| 3   | Local copy and mirror invalidate before each delta           | `packages/harness/src/pod-thread/local-copy.ts:56-91`, `cloud/mirror-writer.ts:31-49`          | Every `events-appended` signal          | Decode, several times        |
| 4   | Activity read calls an unconditional `refresh()`             | `packages/harness/src/activity/runtime-session-activity.ts:139-153`, `event-log.ts:74-82`      | Every activity read, up to 3 retries    | Decode                       |
| 5   | Each model step folds all history and builds every message   | `packages/harness/src/loop/tracked-turn.ts:90-200`, `core/src/assembly/rules/messages-from-events.ts:184-203` | Every step                 | Several Scans + derived      |
| 6   | TUI cloud refresh fetches the full snapshot; remote `head()` reads the whole log | `apps/tui/src/composition/thread-view-refresh.ts:199-224`, `packages/harness/src/cloud/remote-event-log.ts:74-76` | Step and event signals | Send + Decode + hash |
| 7   | Checkpoint recomputes the full identity digest               | `apps/serve/src/runtime-checkpoint.ts:196-218`, `core/src/events/event-identity.ts:120-124`    | Append, step end, roster change         | Scan + hash                  |
| 8   | Web merges, sorts and re-projects the whole history per batch | `apps/web/src/features/threads/data/live-events.ts:8-16`, `transcript-items.ts:191-227`       | Every delta and live output             | Several hundred MB, seconds  |
| 9   | API enrichment refolds historical subsets per append         | `apps/api/src/api/platform/sessions/thread-subscriptions.ts:26-38`, `thread-changed.ts:19-28` | Every append batch, sidebar open        | O(M²) for subscriptions      |
| 10  | Compaction planning and the history-edit mirror              | `packages/core/src/compaction/compaction-plan.ts:12-29`, `apps/serve/src/serve-history-mirror.ts:10-54` | Compact, rewind, summarise    | O(U×N); two full encodes     |

Also blocking: full API and web snapshots on open (`apps/api/src/api/platform/sessions/append.ts:210-257`
reads with no limit; the snapshot holds `FOR UPDATE` on the thread while it reads, `thread-head.ts:26-31`),
and the Mac host's 500-event pages that each reparse the whole file
(`apps/mac/src/host/pods/thread-reads.ts:56-66`).

## Findings that change v2's assumptions

- **Compaction bounds the prompt, not the work.** Ordinary compaction keeps rows
  (`thread-store.ts:314-327`, `threads-history.service.ts:105-122`), and the pipeline converts every
  historical event into messages and token-counts them before `compactedHistory` drops covered ranges
  (`core/src/assembly/pipeline.ts:34-44`, `assemble.ts:37-54`).
- **Ranges bound results, not cost.** Local `read({fromSeq, upTo})` filters a fully materialised array
  (`event-log.ts:86-126`). API reads are keyset but have no limit, page or byte cap.
- **Range bounds disagree:** the API's `fromSeq` is inclusive, the harness's exclusive.
- **Worse than linear:** compaction planning (one full filter per user message), context supersession
  (`core/src/context/supersede.ts:27-37`), subscription grouping (`thread-subscriptions.ts:35`),
  legacy shell launches in rewind (`rewind-shell-occurrences.ts:68-114`), web boot timeline and PR runs.
- **Body searches by `LIKE`/`includes`** for request ids, wake dedupe and subscription ends
  (`sandbox-provisioning/first-message.ts:52-88`, `github/github-sandbox-wake-intent.ts:97-105`,
  `github/github-pr-subscription-links.ts:104-125`) scan event bodies; nothing indexes those keys.
- **Tool outputs live inline in event bodies** and are re-stringified by token estimation, wire
  conversion and transcript folds. Live tails are capped at 60,000 characters; durable results are not.

## Already bounded: patterns to reuse

- Postgres `(threadId, seq)` unique index and keyset ranges (no OFFSET).
- SSE opens and resets from metadata only (`thread-events-live.ts:50-52`); normal delivery is
  incremental; inline pub/sub is capped at 32 KiB (`event-change-publisher.ts:4,20-39`).
- Pod import checks only the incoming batch; wire batches are capped at 500.
- Serve write-behind tracks the durable head and ships a suffix.
- The socket replay buffer holds 2048 frames.
- **The TUI windows correctly:** 1500-event pages, 3000-event retention with eviction
  (`apps/tui/src/composition/thread-reads.ts:6-8,52-112`), an accumulator that folds only new events
  (`store/log-window.ts:37-67`) and mounted-entry windowing. Its opening and cloud refresh are not.
- Web mounts chat items through Virtua; that bounds rendering, not data.
- Roster and subscription registries hold folded current state after a first full replay.
- `Thread.working/awaiting/lastOutcome` are materialised columns (`thread-status.ts:33-68`): the right
  pattern for every other piece of current state.
