# Wire-surface census

Part of the evidence for [v2](../README.md). A condensed transcription of a read-only, static
exploration of the repository at commit `a0bf4110` (2026-11-01, refreshed after #1640–#1649),
not a capture of live traffic.
The full report had per-procedure tables with anchors; this keeps the counts, the topology, the
duplicated paths and the gaps. Statements marked _(inferred)_ are conclusions, not observations.

Anchor prefix: **H**=`packages/harness/src`. Other anchors are repo-relative paths or bare file
names inside the area named in the same sentence.

## Headline

Atlas has no single client ⇄ control plane ⇄ runtime protocol. There are five:

1. tRPC over HTTP and SSE from clients to the API (`/v1/trpc`, `packages/api-router/src/client.ts:24-64`).
2. A direct WebSocket from clients to serve (`/v1/session`, subprotocols `atlas.v1` and
   `bearer.<token|ticket>`, `apps/serve/src/session-server.ts:99-194`). The API only mints a 60 s
   HMAC ticket (`thread-pod.service.ts:141`) and never relays the live channel.
3. Bidirectional best-effort event replication between serve and the API (`sandboxSelf.events` up,
   `sandboxSelf.watchEvents` tick plus read down), with independent seq allocation.
4. Independent side channels for activity, checkpoint, context files, boot steps, PR mailbox and
   wakes, title and model.
5. The Mac loopback REST host (13 operations), which keeps its own serve WebSocket and a local
   transcript copy. In-process TUI sessions use no wire at all (direct ports and an in-memory
   `DeltaChannel`).

Local Docker pods use the same serve WebSocket but replicate nothing to the API (the
`mirrorsThreadState` gate, `packages/wire/src/boot-progress-wire.ts:58-60`).

## Counts

| Surface                                                 |                                                                                    Count |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------: |
| API tRPC routers / procedures                           |                                    40 / 168 (55 queries, 106 mutations, 7 subscriptions) |
| Client-reachable / runtime-reachable / both             |                                                                            153 / 78 / 63 |
| Procedures that admit local-pod lease tokens            |                                                                                       25 |
| Serve WebSocket frames, client → serve / serve → client |                                                                                  10 / 18 |
| Serve WebSocket request ops, declared / dispatched      |               51 / 49 (`read-session-manifest` and `read-session-files` have no handler) |
| Serve REST                                              |                                                       3 (health, park, drain; raw token) |
| API bespoke REST                                        | 5 (2 GitHub hooks, app callback, MCP OAuth callback, health) plus the better-auth family |
| Mac loopback ops                                        |                                                                                       13 |
| Port registry                                           |                                                         48 ports: 10 detached, 38 `none` |

## Cursor spaces that must not be conflated

| Cursor                | Where                                                  | Behaviour                                                                                                                                              |
| --------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Channel signal cursor | serve `FrameBuffer` (`apps/serve/src/frame-buffer.ts`) | 2048 frames; resets when serve restarts                                                                                                                |
| Durable event seq     | the conversation log                                   | On a gap the client drops the cursor and reloads by event seq (`socket-greet.ts:43-107`, `packages/client/src/channel/remote-channel-frames.ts:63-85`) |
| API SSE cursor        | `thread-event-cursor.ts`                               | `v1:<historyRev>:<seq>`                                                                                                                                |

## Duplicated logical paths with multiple origins

1. **Events.** Pod JSONL → serve `read-events`; pod → `sandboxSelf.events` → Postgres → API reads
   and SSE; pod → client-home mirror (`H/pod-thread/local-copy.ts`); home mirror →
   `threadEvents.import` → Postgres (`H/cloud/mirror-upload.ts`); API-origin history → watch tick →
   pod hydration. Origins: the API send/append/replace/history procedures _and_ the runtime loop.
2. **Messages.** WebSocket `send` (local intake, memory-only send-id dedupe) vs API
   `threadMessages.send` (Postgres allocation). Two durable-input lanes. This is the
   [seq-466 incident](incident-2026-11-01-seq466.md).
3. **PR events.** Four paths: API mailbox SSE → runtime journal; API wake-intent appends `pr-event`
   into the transcript (`github-sandbox-wake-intent.ts:46-94`); the TUI forwards it as an ordinary
   WebSocket send (`apps/tui/src/composition/cloud/pr-event-forwarder.ts:89-126`); the runtime
   journals it and acks. Both the API and the runtime originate `pr-event` history. Since #1640/#1642
   this lane additionally carries a webhook inbox, a delivery ack ledger (`GithubPrEventDelivery`),
   per-thread subscriptions and a verdict ledger — more durable records on the same duplicated path.
4. **PR state.** Direct API SSE (`githubPrs.states`) vs API → runtime → serve `pr-states` vs the
   API sidebar enrichment folded from transcript events (`places.ts`). PR state can be healthy
   while the transcript-derived link, branch and worktree are stale (the incident symptom).
5. **Subscriptions.** Runtime registry, the event-derived API projection, and the backend
   `GithubSubscription` leases: three related records, not one object.
6. **Title and model.** API rename and `chooseModel` _and_ serve `rename-thread` and
   `set-thread-model`, with fire-and-forget forwarding, a home copy and the Mac REST rename.
7. **History edits.** API rewind/compact/summarise/replace on Postgres directly _and_ serve edits
   plus rebase. Clients can reach both. Since #1649 the serve flush also reconciles an append fork
   (truncate the API replica below the fork, re-ship the pod's log) instead of wedging — the v1
   stopgap; the underlying two-allocator shape is unchanged.
8. **Threads and children.** API create/open _and_ runtime spawn plus `sandboxSelf.registerChild`.
9. **Activity, checkpoint, lifecycle, boot.** WebSocket signals, `read-activity`, the API activity
   mirror, the checkpoint copy and provider inspection; boot steps come from both an API task and
   serve.
10. **Context files.** Live pod filesystem (WebSocket) vs an API text-only mirror vs a home
    full-text mirror, with different delete and content rules.
11. **Config and accounts.** CRUD, aggregate `sandboxConfig.get`, materialized runtime files, TUI
    backup up/down, and a WebSocket `settings` frame that is ignored (`socket-commands.ts:149-154`).
12. **Read cursors.** API `markRead`, Mac loopback and the in-process port: the same data in three
    homes, not synced.

## Topology: who talks to whom

- **Client → pod directly:** web and Mac cloud (after a ticket), TUI cloud, TUI with a user-supplied
  Vercel sandbox (raw token), TUI local Docker (loopback), Mac local renderer and host, preview
  URLs, provider exec at boot.
- **Client → control plane:** auth, launch/status/connect, seed/snapshot/SSE/sidebar, offline
  intake, PR state and mailbox, accounts and OAuth, settings/secrets/projects/memory, signed-URL
  issuance.
- **Runtime → control plane:** event flush/truncate/`registerChild`, watch/pull,
  activity/checkpoint/context mirrors, boot/stop/deadline/rollover/`exposePort`,
  config/accounts/OAuth/memory, PR subscription and ack.
- The API never relays live client ⇄ serve traffic. It is at once a rendezvous point, a
  provisioner, an independent state owner and a replication peer.

## Local vs cloud asymmetries

- Local pods have no `Thread`, `Event` or checkpoint rows. A GitHub wake is a user wake frame to
  the TUI (`github-local-pod-wake.ts`), not a boot.
- Local-pod tokens reach `githubPrs.stream` but not `ackEvents`.
- The Mac connect result omits `threadId`, which the renderer schema requires
  (`mac pods/service.ts:34-38` vs `packages/wire/src/pod-connect-wire.ts:3-9`). Source-level
  finding only; not reproduced.

## Skew

`atlas.v1`, protocol current 33, minimum 29, with range overlap and capability filtering
(`channel-wire.ts:18-54`, `capabilities.ts`). The boot drift policy is stricter than range
admission. The CI skew checker covers versions and three enums, not structural schema changes.
[Decision 0017](../../decisions/0017-wire-protocol-skew.md)'s API-on-send relaunch story no longer
matches the current send path.

## Port registry caveat

`none` means "no required detached adapter", not "no remote surface". `TerminalPort`,
`GitChangesPort`, `OperatorInputPort` and `MemoryPort` all have remote surfaces outside the
registry. The registry is not a wire census.

## Link to the incident

Unifying transport alone would not have prevented seq 466. v2 must make ownership explicit for
event allocation, history revision, intake acknowledgement, snapshot authority and cross-tier
event identity.

## Gaps

Static only. better-auth generated routes are not enumerated; provider SDK internals are not
recursed; "permitted" is not "proven live caller"; this is not an authorization audit; nested DTOs
are not expanded; Mac native IPC is out of scope.
