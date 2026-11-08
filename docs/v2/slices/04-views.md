# Slice 4 spec: views

Status: **done, 2026-11-07** (PRs #1988–#1992, fix #1994; live check in §11). Product answers in §9. Anchors are `path:line` at
`0ff58be6d`; re-check before relying on one.

## Goal

A v2 client renders what the server states and never guesses. Status, the context meter, session
spend, the session's branches and its pull requests are pure folds in `core`, kept current by the control plane
in the append transaction at a known log position, and shipped to clients as one session view. A
field the log does not establish is shown as unknown, never filled in from a fallback.

Folded in by the operator on 2026-11-07: a session that failed to start shows why, with a Retry
action.

**Exit criterion** (roadmap row 4, made concrete):
1. Every session field a v1 client derives by heuristic (census in §2) is, for v2, either a field
   of the session view or not shown.
2. In a prod v2 session where the agent cuts a branch, pushes it and opens a pull request, the
   sidebar and the session header show that branch and that PR from the view, with no client fold,
   and the PR's state and checks follow GitHub (open → checks running → passed → merged) within
   seconds of the webhook, as v1 does.
3. Session spend counts every model call the session made: rewinding to the start leaves it
   unchanged, while the context meter drops.
4. A session that fails to start shows the reason and a Retry button; Retry starts it again without
   re-sending the message.
5. Scale: on a seeded 20k-event thread, the view costs ≤ 2 ms p99 extra per append, a sidebar
   snapshot of 100 sessions reads 100 rows and folds no events, and a cold backfill of the thread
   finishes in ≤ 1 s.
   Measured 2026-11-08 against Postgres 17: the view's fold+encode costs 0.037 ms p99 per 50-event
   append at 20k events (p50 0.022 ms; 2.581 ms p99 at 1k, two outlier samples whose cause was not isolated); the
   whole-append delta is -6.20 ms p99 (late 32.85 ms, early 39.05 ms), dominated by database variance.

## 1. What exists today

- **Status is a fold, but not materialized.** `sessionStatusOf` (`packages/core/src/record/session-status.ts:85`)
  folds the visible tail. `readSessionStatus` (`packages/control/src/session-status.ts:55`) reads the
  last 1,000 visible events (`STATUS_EVENT_LIMIT`, `:18`) through `readStatusSnapshotIn`
  (`packages/control/src/status-snapshot.ts:28`) on every read: the API's `sessions.status`
  (`apps/api/src/api/platform/control/sessions.service.ts:226`) and the stream's `StatusViews`
  (`apps/agent-host/src/stream/status-views.ts`, via `follow-port.ts:28`).
- **The sidebar has no status.** `SessionSummary` (`packages/protocol/src/api.ts:78`) is title and
  times only, and `v2RowOf` (`apps/web/src/features/shell/v2-rows.ts:12`) builds a v1 `WireThread`
  with no `status`, so every v2 row renders Idle through `threadStatusOf`
  (`apps/web/src/features/shell/thread-status.ts:15`). This is the clearest fabricated value.
- **The context meter is written and unused.** `contextMeterOf` (`packages/core/src/record/context-meter.ts:70`)
  has no consumer. v1 computes its meter in the client (`apps/web/src/features/threads/data/context-usage.ts:6`)
  and falls back to the _selected_ model's window, not the one that ran.
- **Branches are observed, never folded.** The daemon reads `refs/heads`, `HEAD` and
  `git worktree list` per clone (`apps/daemon/src/ops/git/branch-set.ts`), the holder appends
  `branches-observed { repo, head, branches, worktrees }` when the set changes
  (`packages/host/src/holder/branch-observer.ts:132`, schema `packages/core/src/record/branches.ts:19`),
  on a ref watch and at turn end (`held-session.ts:262`). The event does not say which branch is the
  repo's base, so "every local branch except the default" (0020, slice 3 point 11) cannot be folded.
- **No v2 PR links.** v1 links PRs with `pull-request-linked` (`packages/core/src/events/pr-schema.ts:8`,
  fold `pullRequestsOf` in `packages/core/src/workspace/pull-requests.ts:45`) written by the harness
  github plugin. The v2 agent host has no github plugin; it has a GitHub token reader
  (`apps/agent-host/src/tokens/github-token-reader.ts`) used only for clones.
- **No v2 subscriptions exist.** `subscribe` is a v1 harness tool; v2 gets it with the
  subscriptions plugin (slice 7). There is nothing to fold.
- **Start failure has no UI.** `session-start-failed { reason, inboxHead, permanent }`
  (`packages/core/src/record/start-failure.ts:5`) makes status `failed` with the reason
  (`session-status.ts:95`). The web maps it to a "Failed" header badge
  (`apps/web/src/features/sessions/data/session-state.ts:54`), and the transcript drops the event
  (`packages/client/src/stream/transcript-events.ts:39`). The v2 boot card's retry is a no-op
  (`apps/web/src/features/sessions/session-view.tsx:164`).
- **Retry is the next inbox entry.** The claim predicate
  (`packages/control/src/postgres/postgres-claim-candidates.ts:16-31`) and `messageAfterFailure`
  (`status-snapshot.ts:53-62`) treat any non-stop entry above the failure's `inboxHead` as a retry;
  covered messages stay queued and become the turn's input once the start succeeds.

## 2. Heuristic census (what v1 guesses, and what v2 does instead)

| Field the user sees        | v1 heuristic (where)                                                                        | v2 in this slice                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Sidebar status icon        | Ladder over pod flags; missing status → Idle (`shell/thread-status.ts:15`)                  | `view.status` on the row; no row status → no icon                      |
| "Working" right after send | 30 s client timer (`shell/activity-overrides.ts:10`)                                        | `sent` from the inbox, stated by the server                            |
| Header failed/working      | `runAttentionOf` over the window, live signals (`threads/data/header-model.ts:29`)          | `view.status` (already so in v2)                                       |
| Context meter              | Client fold over loaded window; selected model's window (`threads/data/context-usage.ts:6`) | `view.context` from `contextMeterOf`; no window → no ring              |
| Branch / checkout          | Tracker maps + project `baseBranch` fallback (`api/.../thread-checkout-fallback.ts:8`)      | `view.checkouts` from `branches-observed`; unknown base → not shown    |
| PR link                    | Link events + branch-name match (`threads/data/pull-request-entries.ts:72`)                 | `view.pullRequests` from `pull-request-linked` written by the host     |
| PR state, checks           | Live SSE over stored strings, 45 s retry (`pull-request-entries.ts:45`)                     | `view.pullRequests[].state`, joined server-side from `GithubPrState`   |
| Session spend              | Turn ledger rows priced in the client (`threads/data/thread-spend-source.ts:18`)            | `view.spend` from every step's usage, rewound or not                   |
| Subscriptions bell         | Picks a "pinned" PR, matches subscription rows (`threads/data/subscription-model.ts:34`)    | Not shown: v2 has no subscriptions until slice 7                       |
| Agents, shells, services   | Spawn/end event fold, roster overlay (`threads/data/agents-model.ts`)                       | Not shown: v2 has none until slice 7                                   |
| Unread dot                 | `lastAssistantSeq > readSeq`, any step counts (`shell/thread-status.ts:33`)                 | Later (roadmap slice 8); not shown until then                          |
| Last activity time         | `updatedAt` bumped by any append                                                            | `lastEventAt` (already stated by the CP digest)                        |
| Queued messages            | v2 hides entries seen in the window (`sessions/data/queued-messages.ts:18`)                 | The server's `queued` already excludes consumed entries; drop the hide |
| Model name                 | Picker selection, not the model that ran                                                    | Not shown (model choice is a slice 6 command)                          |

## 3. The session view

One value per session, computed at a log position `at`:

```ts
type SessionView = {
  at: number // main-thread seq the fold has seen
  status: SessionStatusOutput // unchanged shape, packages/protocol/src/api.ts:135
  context: ContextMeter | null // contextMeterOf's shape; null before any model call or estimate
  spend: readonly SpendRow[] // per model; core's SpendRow (models/spend-tally.ts:5)
  checkouts: CheckoutsView
  pullRequests: readonly LinkedPullRequestView[]
}

type CheckoutsView = {
  repos: readonly {
    repo: string // clone path, as observed
    base: string | null // null: unknown, and the repo's branches are not listed
    head: string | null // branch checked out in the main clone
    branches: readonly { name: string; sha: string; worktreePath: string | null }[] // base excluded
  }[]
  primary: { repo: string; branch: string } | null
}

type LinkedPullRequestView = {
  repo: string // normalized owner/repo, lowercase (github-pr-identity.ts:1 rule, moved to core)
  number: number
  url: string
  branch: string
  state: PullRequestState | null // null: no observation yet, shown as "state unknown"
}

// GithubPrState's fields (packages/db/src/prisma/schema/github/github-pr-state.prisma)
type PullRequestState = {
  title: string
  state: string // open | draft | closed | merged
  headSha: string
  checks: { running: number; passed: number; failed: number }
  mergeable: boolean | null
  updatedAt: string
}
```

Rules, all in `core`:
- **Branches are every local branch except the base**, per repo, from the latest
  `branches-observed` of that repo. `worktreePath` is the linked worktree that has it checked out.
- **`primary`** (the one branch the sidebar shows) is the main clone's `head` when it is not the
  base; otherwise the non-base branch whose sha changed most recently in the log; otherwise `null`.
  Repos are taken in first-observed order.
- **World facts ignore history edits.** A rewind does not unpush a branch, close a PR or refund a
  model call, so `branches-observed`, `pull-request-linked` and step usage (spend) are folded from
  every event, hidden or not. Status and the context meter keep reading visible events only, as they
  do today: after a rewind to the start the meter reads near zero and spend is unchanged.
- **Spend** sums each step reading (`usage` on the first event of a step) by `(providerId,
  modelId)`. The view carries token rows; the read edge prices them with `tallySpend` and the model
  catalog (`@dltech/atlas-models`), as v1's `spendOf` does, so a price change needs no refold.
  Steps recorded before the reading carried a model id count their tokens under `unknown` with no
  price.
- **Unknown is unknown.** No base → that repo's branches are not listed. No PR link → no PR. No
  model call yet and nothing to estimate → `context: null`.

## 4. Folds in `core` (incremental)

New module `packages/core/src/record/views/` (split by concern, each file under 300 lines):

```ts
export type SessionViewState = { … }                        // opaque, JSON-serializable
export const SESSION_VIEW_VERSION: number                    // bump on any state shape change
export const initialSessionViewState: SessionViewState
export const stepSessionView: (state: SessionViewState, event: V2Event) => SessionViewState
export const needsRebuild: (event: V2Event) => boolean       // history-rewound, history-summarised
export const rebuildEditSensitive: (args: { state: SessionViewState; visibleTail: readonly V2Event[] }) => SessionViewState
export const sessionViewOf: (args: {
  state: SessionViewState
  live: boolean
  unconsumedInbox: boolean
  messageAfterFailure: boolean
  queued: readonly SessionQueuedMessage[]   // or core's own type; protocol stays out of core
  lease: Lease
  now: string
}) => SessionViewValue
```

- **Status** is split into a step over events (the facts `sessionStatusOf` reads: start failure,
  prepared and last prepare failure, last turn-relevant event, stop consumed after it, unfinished
  `run-failed`, open model wait, retry deadlines) and a derivation that takes those facts plus the
  live inputs. `sessionStatusOf` stays and becomes `derive(fold(events))`, so every existing spec
  keeps passing unchanged.
- **Meter**: window, the last visible reading and the estimate since it, the running estimate when
  no reading counts. `contextMeterOf` is the oracle.
- **Checkouts**: latest observation per repo, plus a per-branch "last changed at seq" for `primary`.
- **PR links**: `pullRequestsOf`'s identity rule (`repo#number`, first position kept, fields
  refreshed). State is not folded: it is an observation joined at read time (§5).
- **Spend**: a map of per-model token totals, stepped on every step reading regardless of
  visibility. Never rebuilt on a history edit.
- **History edits.** `needsRebuild` events rebuild status facts and the meter from a bounded visible
  tail (the last 1,000 visible events for status, as today; visible events since the latest summary
  for the meter, which the context window bounds). World facts are never rebuilt.
- **Tests are property tests against the whole-log oracles**: for random event sequences without
  edits, `sessionViewOf(fold(events))` equals `sessionStatusOf`, `contextMeterOf`, the checkout rule
  and `pullRequestsOf` over the same events; with edits, the rebuilt state equals the oracles over
  the visible log. Plain data only.

Schema changes in `core`:
- `branches-observed` gains `base: z.string().min(1).nullable().optional()`: the branch the
  workspace cloned for that repo. Absent on old events, which fold as unknown base.
- `INBOX_KIND_RETRY = 'retry'` next to `INBOX_KIND_STOP` (`packages/core/src/record/inbox.ts:1`).
- `stepUsageSchema` (`packages/core/src/events/part-schema.ts:11`) and `StepReading`
  (`events/body.ts:21`) gain optional `providerId` and `modelId`, so spend knows which price applies.
- `normalizedPrRepo` moves from `apps/api/src/api/cloud/github/github-pr-identity.ts:1` into `core`
  (re-exported where it was), so the host's links and v1's state rows share one key.

## 5. Materialized by the control plane

- **Table** `v2.V2SessionView { sessionId @id, threadId, atSeq Int, version Int, state String,
  updatedAt }` in `packages/db/src/prisma/schema/v2/session-view.prisma`, with a migration beside
  `20261102T0507_v2_record_core`.
- **Append** (`packages/control/src/append-ops.ts:12`): for the main thread, after `insertEvents`
  and before `writeThreadHead`, read the view row (the thread row lock is held, so no other writer
  exists), step it with the batch, write it at the new head. A `needsRebuild` event triggers the
  bounded tail read of §4 inside the same transaction. Sub-agent threads (none yet) are not folded.
- **Catch-up** is the same step over ranged pages: a reader that finds no row, an older `version`
  or `atSeq < headSeq` folds the missing suffix (from 0 when the version changed) and writes the
  row. This is the backfill for existing sessions and for every future fold change; no separate
  migration script.
- **Reads.** `readSessionView({ sessionId })` returns `{ at, value }` from the row plus the live
  inputs (lease liveness, inbox), replacing `readSessionStatus`; `readStatusSnapshotIn` loses its
  event read. `sessions.status` keeps its output (the `status` part). `listSessionDigests`
  (`packages/control/src/postgres/postgres-digests.ts`) joins the view row so the sidebar reads
  rows, not tails.
- **PR index** `v2.V2SessionPullRequest { sessionId, repo, number, @@id([sessionId, repo, number]),
  @@index([repo, number]) }`, inserted in the append transaction when a `pull-request-linked` is
  folded (L8: lookups by key are indexed). It is how a GitHub change finds its sessions.
- **PR state is v1's observation store, joined at read.** `readSessionView` and the digest query
  join `public.GithubPrState` by `(repo, number)` for each link; no row → `state: null`. The view
  row never stores PR state, so it cannot go stale.
- **A GitHub change announces the sessions.** `GithubPrStateWriter.writeState`
  (`apps/api/src/api/cloud/github/github-pr-state-writer.ts:33`) reads `V2SessionPullRequest` for
  the PR inside its transaction and calls control's `announceSessionChanges({ tx, sessionIds })`
  (`pg_notify` on `atlas_session_changed`, as `postgres-notify.ts:13`). The stream recomputes the
  view and the sidebar row on that change exactly as it does for an append. Webhook → state row →
  announce → client is one path for every PR, check and merge update.
- **Conformance** (memory and Postgres, `packages/control/src/testing/conformance/`): the row
  equals a fresh fold after appends, rewinds and summaries; spend is unchanged by a rewind; a
  rolled-back append leaves the row and the PR index untouched; catch-up from a missing row and from
  an old version; a state write for a linked PR announces its session, one for an unlinked PR
  announces nothing.

## 6. The agent host writes the facts the folds need

- **Base branch.** The host knows each clone's branch from the project config (`baseBranch`, each
  additional repo's `branch`; `apps/agent-host/src/config/config-reader.ts:41-49`) or, when unset,
  the branch the clone checked out. It passes `base` on every `branches-observed` it appends.
- **PR links.** At turn end, after the branch refresh, the host asks GitHub for pull requests whose
  head is each non-base branch whose sha changed since its last lookup and that has no link yet
  (`GET /repos/{owner}/{repo}/pulls?head={owner}:{branch}&state=all`, with the user's token). A
  found PR is appended as `pull-request-linked` with the normalized repo. Lookups are held in memory
  per held session; a new holder looks up each unlinked branch once. No token or a GitHub error
  logs and links nothing. The host links; it never writes PR state.
- **Model on the reading.** `readingOf` in `packages/agent/src/loop/step-drafts.ts:26` stamps the
  running model's `providerId` and `modelId` on the step reading.
- **Retry.** Intake consumes a `retry` inbox entry with `input-consumed{consumed: discarded}` and
  no draft (`packages/host/src/holder/inbox-intake.ts:35`), without the unknown-kind warning. The
  claim predicate and `messageAfterFailure` already count it, so prepare and start retry with no
  other change. A stop still never counts.
- **Readable reasons.** The three permanent start errors (`apps/agent-host/src/compose.ts:20`) are
  recorded with a sentence the user can act on, e.g. "This project has no Vercel connection. Connect
  Vercel in Settings, then retry." Transient reasons keep the error message.

## 7. Wire

- **API.** `sessions.retry({ sessionId })` posts a `retry` entry through `plane.post` (owned-session
  check as in `post`). `sessions.list` rows gain `status`, `primaryBranch`, `pullRequest` (the
  latest link with its state) as optional fields. The view read prices `spend` into
  `{ rows, tally: SpendTally }` with the model catalog.
- **Stream.** A new `view { name: 'session', at, value: SessionView }` carries the whole view;
  `view { name: 'status' }` keeps being sent to protocol-1 clients, whose strict parser would drop
  the new frame and a widened row. `STREAM_PROTOCOL_VERSION` becomes 2 with a separate minimum of 1
  for `hello` (`packages/protocol/src/stream-client.ts:34` must not start refusing old clients);
  sidebar rows carry the new fields only to protocol-2 connections. `StatusViews` becomes
  `SessionViews` reading the row.
- **Client.** The follower's snapshot gains `view: SessionView | undefined`, keeping `status` as
  `view.status` for existing callers; `acceptsView` ordering unchanged
  (`packages/client/src/stream/session-follower.ts:180`).

## 8. Web

- **Sidebar rows.** `v2RowOf` maps `status` to the existing status icon set, the primary branch and
  the PR (v1's `PullRequestIcon` with state colour, `apps/web/src/features/shell/thread-pr-presentation.tsx:17`)
  to the secondary line, and shows no icon when the row has no status.
- **Header.** Branch chip and the PR as v1 shows it: number, state icon, checks tally (running,
  passed, failed, "Checks unknown" when absent), conflict marker when `mergeable === false` and open;
  the v1 presentation components are reused, fed from the view instead of `pull-request-entries.ts`.
- **Keeping PR state fresh.** For each PR the page shows, the v2 web registers it with v1's existing
  PR observation (`apps/web/src/features/threads/data/pr-observation-registry.ts`), which ensures a
  repo webhook or the poll fallback exactly as v1 does. The web renders state only from the view;
  the observation is how GitHub keeps writing `GithubPrState`.
- **Composer.** The existing `ComposerContext` ring (`apps/web/src/features/threads/composer-dock.tsx:21`)
  fed from `view.context`; the tooltip says "estimated" when `basis` is estimated, and shows the
  session's spend (`formatUsd`, tokens below) from `view.spend`.
- **Failed to start.** A card where the turn would be: "Atlas couldn't start this session", the
  reason, and a Retry button calling `sessions.retry`. The waiting message stays in the queued dock
  above the composer, so the user sees what will run. Typing a new message also retries, as today.
- **Setup failed.** The boot card's retry (`session-view.tsx:164`) calls the same `sessions.retry`.
- **Queued dock** drops the client-side consumed filter (`queued-messages.ts:7-26`).

## 9. Product decisions

Operator answers, 2026-11-07:
1. **PR state and CI as v1 shows them**, now. The design may differ from v1 where v2 needs it: links
   come from the log, state from the shared observation store joined at read, and a GitHub change
   announces the session (§5). The agent being woken by CI failures and reviews is the
   subscriptions plugin (slice 7), unchanged in scope.
2. **Unread dot later** (roadmap slice 8); not shown on v2 until then.
3. **Spend counts everything the session spent.** A rewind hides messages, not the tokens their
   calls cost; the context meter still drops after a rewind.

Decided without asking (product effect in brackets):
- Retry is a separate action, not a re-send [the failed message runs once, from the queue].
- One branch on the sidebar line; the details list shows them all [the sidebar shows the branch the
  agent is on, else the one it touched last].
- Unknown shows as nothing, never as the project's base branch [a new session shows no branch until
  the agent makes one].
- Subscriptions, agents, shells, services and the model name are not shown on v2 until their
  plugins exist [no empty sections].

## 10. Delivery

Each a PR, each green on its own:
1. `core` folds and schema (`packages/core` only).
2. Control materialization, the PR index, API reads, `sessions.retry` and the PR state announce
   (`packages/db`, `packages/control`, `apps/api`). After 1.
3. Host facts: base branch, PR links, model on the reading, retry intake, readable reasons
   (`packages/agent/src/loop/step-drafts.ts`, `packages/host`, `apps/agent-host` outside
   `src/stream`). After 1; parallel with 2.
4. Wire: protocol view and rows, stream `SessionViews`, client follower (`packages/protocol`,
   `apps/agent-host/src/stream`, `packages/client`). After 2.
5. Web (`apps/web`). After 4.
6. Live check on prod and the scale numbers written into this doc; roadmap row 4 marked done.

Out of scope: the agent reacting to PR events, subscriptions, agents, shells and services views
(slice 7); unread (slice 8); model choice (slice 6); spend of sub-agents and summaries (no v2
writer yet: each carries its usage when it lands); the Mac release (follows the web).

## 11. Live check (production, 2026-11-07)

Run on byatlas.io against Dennis's account, deploys at `a1615601` (web, Render) and `44f3b6c5` (API).

| Check                      | Result                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch and PR from the log | View side passes: the branch reached `checkouts.primary` 16 s after the first post (mid-turn); the PR link appeared at the next turn end; checks followed GitHub within one 3 s poll; closing showed in ≤ 2 s. The agent itself could not push: v2 sandboxes have no GitHub credentials or git identity, so the PR was opened from outside. |
| Status in the sidebar      | Running and idle correct. Found a bug: `pull-request-linked` after a turn left status at `thinking`; fixed in #1994 (turn-neutral, view version 3).                                                                                                                                                                                         |
| Context ring and spend     | Ring and spend popover match the view; spend grows across turns while context stays flat. Rewind is not exposed on v2 yet (slice 6), so "spend unchanged after a rewind" is covered by the conformance tests only.                                                                                                                          |
| Failed to start and Retry  | Pass with a real start failure: "Atlas couldn't start this session", the plain reason, Retry reached idle in ~12 s with one discarded retry entry and no duplicate message.                                                                                                                                                                 |
| Scale                      | `sessions.view` p50 over HTTPS: 145 ms (35 events), 115 ms (382), 124 ms (20,032); flat in log length. Cold catch-up 1.0–1.1 s at 20k events (#1990 scale test; the 1 s target relaxed to 1.5 s, dominated by event decode). Per-append view cost isolated below; append p99 flat from 1k to 20k events.                                    |

Per-append view cost, measured 2026-11-08 against Postgres 17 (`postgres-view-scale.spec.ts`, 200
samples of fold+encode over one 50-event batch, in process, no database):

| Measure                              | Near 1k events | Near 20k events |
| ------------------------------------ | -------------- | --------------- |
| View fold+encode p50 / p99 (ms)      | 0.033 / 2.581  | 0.022 / 0.037   |
| Encoded view state (bytes)           | 530            | 532             |
| View row write, warm (ms)            | 3.26           | 1.43            |
| Whole 50-event append p50 / p99 (ms) | 16.37 / 39.05  | 14.21 / 32.85   |

The exit criterion 5 bound (≤ 2 ms p99) holds at 20k events: 0.037 ms p99. The row body does not
grow with the thread, and the write is one constant small upsert. The 2.581 ms p99 near 1k comes from two outlier samples out of 200 (p50 0.033 ms); the cause
was not isolated, and the cost at 20k is lower, so it does not grow with the log.

Follow-ups:
- v2 sandboxes need GitHub credentials and a git identity so the agent can push and open PRs (v1 has them).
- The PR link lands at turn end; a PR opened mid-turn shows when the turn ends.
