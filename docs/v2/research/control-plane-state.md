# Control-plane and client state census

Part of the evidence for [v2](../README.md). A condensed transcription of a read-only exploration
of the repository at commit `a18e7413` (2026-11-01). It covers all 48 Postgres models, every
production `Event` / `Thread.head` mutation path found, Redis key families, API in-memory state
and the web and Mac derivations. The full report gave per-model writer and reader anchors; this
keeps the findings. Statements marked _(inferred)_ are conclusions, not observations.

Anchor prefixes: **S**=`apps/api/src/api/platform/sessions`, **P**=`apps/api/src/api/platform/sandboxes`,
**G**=`apps/api/src/api/cloud/github`, **Q**=`apps/api/src/api/cloud/sandbox-provisioning`,
**WD**=`apps/web/src/features/threads/data`, **WS**=`apps/web/src/features/shell`,
**CL**=`packages/client/src`, **DB**=`packages/db/src/prisma/schema`.

## Headline

Postgres is a replica of pod history, an independent producer of that history, and an independent
editor of it, all at once. Clients then combine that hybrid history with separately replicated
metadata, runtime activity, GitHub state and local optimistic state.

## Models that copy pod or runtime state

| Model                   | Overlap                                                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Event`                 | pod log mirror, API-allocated events, and API-edited history                                                                                        |
| `Thread`                | head, `lastAssistantSeq`, working/awaiting/outcome/`activityAt`, lineage and model overlap pod stores. `rev` can rise without `Event` progress      |
| `Session`               | title, repo, workspace, execution and teammate metadata overlap pod session meta                                                                    |
| `CloudSandbox`          | runtime checkpoint, endpoint/version and activity mixed with API provisioning authority. A checkpoint write does not check `Event` completeness     |
| `ContextFile`           | pod context mirror (latest upload or delete-missing wins)                                                                                           |
| `Turn`                  | runtime accounting mirror, upserted by `runId`                                                                                                      |
| `GithubSubscription`    | direct API transport subscription plus a projection derived from conversation events (created and ended only; rewind and replace do not rebuild it) |
| `GithubPrEventDelivery` | records that a harness journaled an external event; distinct from event-mirror success                                                              |
| `SandboxBootStep`       | API provisioning progress plus pod-reported agent-start                                                                                             |

**External GitHub projections** (not pod copies): `GithubPrState`, `GithubAppInstallation`,
`GithubPrHeadCheck` (also a durable verdict obligation).

**Pure control-plane authority**: auth (`User`, `AuthSession`, `Account`, `Verification`,
`DeviceCode`); provider accounts (`AgentAccount`, `ActiveAccount`, `OauthConnection*` with
generation fences, `CredentialAvailability` with fence and revision); projects and project config;
user config, secrets, MCP and MCP OAuth; `Memory` (revision); `PublishedBundle`; `UserFile`
(revision-fenced); `ThreadRead`; `ComposerDraft` (last write wins); `LocalPodLease`;
`PreviewTunnel` / `PreviewRoute`; `GithubConnection`; `GithubRepoHook`; `GithubPrEvent` (mailbox);
`GithubWebhookInbox`; `SshSigningKey`; `UserVercelCredential`.

## Every production `Event` / `Thread.head` mutation

**Storage primitives**

- `appendStoredWithin` (`S/append.ts:159-206`, head += n).
- `EventsService.replaceWithin` (`S/events.service.ts:84-118`, delete all and re-insert from 1).
- `applyPodEvents` (`P/pod-events.ts:45-100`) and `truncatePodEvents` (`:123-143`).
- `ThreadsHistoryService` rewind, fork and mark (`S/threads-history.service.ts:78-96, 147-188,
211-280`).
- `takeBack` (`Q/thread-messages.service.ts:104-115`, head -= 1).
- Thread creation, and cascade deletes of rewound children (`S/threads-history.service.ts:37-59`).
- No in-place `Event.update`.

**API seq-allocating callers (9)**. The source report counted nine; this list splits `threads.open`
into its two cases to reach nine _(inferred)_.

1. `threadEvents.append`.
2. `threads.open`, new thread.
3. `threads.open`, reopen suffix.
4. `threads.create` with a first message (`Q/thread-launch.service.ts:66`).
5. **`threadMessages.send`**, allowed while the pod is _running_ (`Q/sandbox-provisioning-rows.ts:29-32`).
6. Archive subscription-ended (`S/thread-archive.service.ts:60`; emits `threadChanged`, not
   `eventsAppended`).
7. GitHub wake-intent `pr-event` (`G/github-sandbox-wake-intent.ts:62`).
8. Compact and summarise marker `advanceHead`.
9. Take-back `retreatHead` (moves the head back by one rather than allocating forward).

**Import and edit entry points**: `sandboxSelf.events`, `threadEvents.import`,
`sandboxSelf.truncateEvents`, `threadEvents.replace`, `threads.rewind` / `compact` / `summarise` /
`fork`, `sandboxSelf.registerChild`.

**Observations**

- API locks are per Postgres `Thread` and reserve no pod-local seq space.
- Import requires increasing seqs but not contiguous ones.
- Summarise can change history without changing head (`historyRev` covers it).
- Reopen compares only the last `(type, body)` boundary, not a history hash.
- Generic replace and rewind do not maintain the assistant-cursor or subscription projections.

## Five riskiest dual-ownership points

1. Independent API and pod seq allocation ([the incident](incident-2026-11-01-seq466.md)).
2. Independent destructive-history authority. `historyRev` protects API clients but is not an
   exclusive owner protocol between API and pod.
3. Subscription events, transport links, mailbox delivery and journal acks are four records.
4. Model preference is duplicated, and the client reconciles by _commanding the pod_ with the API
   copy on reconnect (`WD/live-model-recheck.ts:17-39`). A stale copy becomes a command.
5. Independent "alive" projections (activity, checkpoint revision, boot steps, PR transport,
   `Thread.rev`) hide a frozen transcript. This is the shape of the incident.

## Redis

- Pub/sub only: `atlas:thread-signals`, `atlas:github-pr`. Publish failures log and drop; streams
  recover from Postgres.
- Keys under `atlas:github:observe:v1:`: authorization proofs and versions, leases, active / repo /
  pr indices, cursor, per-minute HTTP budgets, cooldowns, retry attempts. TTLs 120 s to 20 min.
  Leases, proofs and cursors are reconstructable; budget counts, cooldowns, fences and backoff are
  not.
- Rate limiter: Nest `ThrottlerStorage`, keys `trpc:<procedure>:<IP>`, default 100/min.

## API in-memory state (non-durable)

Signal registries, change runners, pod publisher chains, live and per-thread stream buffers
(1000-frame caps, 30 s heartbeat, 240 s lifetime), event SSE order cursor, PR fan-out coalescing,
wake debounce, local observation adapter, repo-access promise cache (no TTL), hook verified-alive
cache (5 min), model and skill catalogue LRUs, pod resources cache, titling credential snapshot,
health and drain flags.

## Client derivations

- An open web thread composes about 15 independent sources (`thread-view.tsx:59-144`), not one
  canonical object.
- Three overlapping history layers: the transcript query cache (random-UUID key per mount, 5 min
  GC), the API events reader (gap → full re-read) and the live pod controller (`ReadEvents` from
  local head). Selection rule: live when connected, else API, so a fallback can show older durable
  history _(inferred)_.
- Sidebar: a live-list fold, query caches, localStorage `atlas:sidebar-threads` (no user id in the
  key and no clear on sign-out _(inferred)_) and created / activity (30 s optimistic) / archive /
  naming overlays.
- Unread compares API `lastAssistantSeq` with `readSeq`. Mark-read observes the API head, not pod
  text.
- Branch: checkout fold, else worktree fold, else **project base-branch fallback**
  (`S/thread-checkout-fallback.ts:11-28`), which is why the incident thread showed `staging`.
- PR states: the API cache and pod states are merged with "pod overwrites unless API terminal".
  There is no timestamp or head-SHA ordering (`WD/pr-states-merge.ts:29-41`).
- Model: optimistic local choice → pod if connected, else API → reconnect re-pins the pod from the
  API.
- Mac: a local JSONL home copy via the harness; a synthetic local `WireThread` with head 0; the
  first message is held in a module-level `Map` until sent.

## Gaps

better-auth internal SQL; historical migrations and test writers; generated contract drift; pod
and TUI internals (see [pod-side-state](pod-side-state.md)); every UI-local variable; Mac native
depth; external platform retention. Static reading only.
