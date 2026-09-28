# Real-time PR/CI: design spec

Status: approved direction, implementing.
Supersedes: the webhook-fed Neon cache + app-installation design that the current
`apps/api/src/api/cloud/github` module implements (see "Migration" below).

## Why this exists

The TUI tile and `/resume` show PR and CI state for the checkout a session stands on. Until
now, a signed-in session got that state by polling the Atlas Cloud API, which served a Neon
cache fed by the `atlas-by-dl` GitHub App's installation webhooks. That design broke in two
ways:

1. **Wrong ownership model.** Atlas Cloud is a per-person harness, not an org harness. An app
   installation grants org-wide visibility the installing user may not have, and sees repos
   that have nothing to do with the session. The only correct access boundary is the user's
   own GitHub credentials.
2. **Fragile plumbing.** Every cache write and live fill routed through the app installation
   token. When that broke (2026-09-26), deliveries kept arriving but the cache froze, and
   every signed-in tile went blank while signed-out `gh` polling would have kept working.

The replacement: the API is a **thin fan-out**. Clients subscribe to PRs over SSE; the API
creates repo webhooks on the fly using the subscribing user's own OAuth token, verifies
deliveries, writes a last-known state row, and pushes updates to subscribed sessions. No app
installation, no org-wide grant, no client-side GitHub polling in cloud mode.

## Principles

- **The user's OAuth token is the only credential.** Every GitHub call the API makes —
  webhook management, REST reads — is made as the subscribing user. If the user can't see a
  repo, Atlas can't either, and no other user's setup grants them anything.
- **Real-time is the point.** The API is the middleman so updates push to the tile in
  under a second, and later feed the LLM directly. Polling is degraded mode, never the plan.
- **Durable over clever.** The API can restart mid-deploy at any time. Everything load-bearing
  lives in Postgres; in-process state is a cache that can be rebuilt from the DB.
- **One hook per repo, shared across users.** Fan-out happens at delivery time against the
  subscription table, not by creating per-user hooks.
- **Local cache is primary for reads.** A session renders PR/CI state from its own event log
  instantly on open and `/resume`; the live stream corrects it. Neon is the mailbox for when
  no client was connected, not a queried read cache.

## Actors and surfaces

- **TUI session (local, signed in):** subscribes to the API, receives SSE pushes. Does not
  run `gh pr view` on a timer.
- **TUI session (local, signed out):** unchanged — the `GhPullRequestPort` polls `gh`.
  This is degraded mode and stays.
- **Cloud/serve session (sandbox):** subscribes through the same harness port; the sandbox
  has no local `gh` fallback, so SSE is its only source.
- **API:** holds subscriptions, hooks, and last-known PR state in Postgres; verifies webhook
  deliveries; fans out to connected SSE streams.
- **The LLM:** receives PR/CI transitions as harness-seeded context (see "LLM seeding").

## GitHub auth: OAuth app, not GitHub App

The GitHub connection switches from GitHub-App device flow to a plain **OAuth App** with
device flow. Rationale: OAuth App tokens do not expire until revoked. The current
GitHub-App user tokens die silently every 8 hours (the known #563 issue), which would
re-break webhook management on a timer even after this redesign.

- Env: `GITHUB_OAUTH_CLIENT_ID` (new). `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` and the
  `GITHUB_APP_*` keys are retired once the app module is deleted.
- Requested scopes: `repo read:org admin:repo_hook`. (`workflow` is dropped unless a
  consumer needs it; `admin:repo_hook` is required for on-the-fly hook creation.)
- The device-flow endpoints (`github-device-client.ts`) stay; only the client id and scope
  list change.

## Data model (Postgres, apps/api/prisma)

New models; the existing `GithubPullRequest` / `GithubWebhookEvent` models are replaced by
these (see "Migration").

```
GithubSubscription
  id          String   @id @default(cuid())
  userId      String
  repoFullName String               # "owner/repo"
  prNumber    Int
  expiresAt   DateTime              # heartbeat-renewed; dead ~5 min after last beat
  createdAt   DateTime @default(now())
  @@unique([userId, repoFullName, prNumber])
  @@index([repoFullName, prNumber])
  @@index([expiresAt])

GithubRepoHook
  repoFullName String  @id
  hookId       BigInt               # github's hook id
  secret       String               # per-repo HMAC secret, encrypted at rest
  createdBy    String               # userId whose token created it
  status       String               # "active" | "orphaned" | "deleting"
  idleSince    DateTime?            # set when last subscription across all users expires
  createdAt    DateTime @default(now())

GithubPrState
  repoFullName String
  prNumber     Int
  title        String
  url          String
  state        String               # open | draft | merged | closed
  headBranch   String
  headSha      String
  checksRunning Int
  checksPassed  Int
  checksFailed  Int
  mergeable    Boolean?
  updatedAt    DateTime             # github-side update time when known
  @@id([repoFullName, prNumber])
  @@index([repoFullName])
```

`GithubPrState` replaces `GithubPullRequest`. The rename is deliberate: it is a last-known
mailbox written by deliveries and subscribe-pulls, not a read-through cache with fills.

## API surface (apps/api, NestJS, versioned `/v1`)

All routes require a session (`SessionAuthGuard`) except the webhook receiver.

### Subscriptions (client-facing)

```
POST   /v1/github/subscriptions        { repoFullName, prNumber }  -> subscription + current state
DELETE /v1/github/subscriptions/:id
POST   /v1/github/subscriptions/:id/heartbeat   -> { expiresAt }
GET    /v1/github/prs/stream?repos=owner/a,owner/b   (SSE)
```

- **Subscribe** validates repo access with the user's token (existing `requireRepoAccess`
  pattern), ensures a `GithubRepoHook` exists (creating it if not — see "Hook lifecycle"),
  upserts the subscription, performs a **pull-on-subscribe**: one REST read of the PR as the
  user, upsert `GithubPrState`, and return that state in the response so the client renders
  immediately without waiting for the stream.
- **Heartbeat** is sent by the client every ~60s per active subscription; each beat sets
  `expiresAt = now + 5 min`. Dead clients' rows expire on their own; no explicit DELETE is
  required for correctness.
- **The SSE stream** is one connection per session, carrying events for every subscription
  the session holds. Events: `pr-state` (full `GithubPrState` payload) and `heartbeat`
  (comment frame every 30s to defeat idle-proxy kills).

### Webhook receiver (github-facing)

```
POST /v1/github/hooks/:repoFullName    (HMAC-verified, @Public, throttled)
```

The hook URL embeds the repo so the handler can load the per-repo secret without guessing.
Handler is **stateless**:

1. Verify `x-hub-signature-256` against the hook's secret. Unknown repo or bad signature → 401.
2. Normalize the event (`pull_request`, `check_suite`, `check_run`, `push`). Persist nothing
   raw — the old `GithubWebhookEvent` firehose is dropped; `GithubPrState` is the record.
3. For affected PRs, upsert `GithubPrState` from the payload. For `pull_request` events the
   payload carries everything needed. For check events, one REST read per affected PR **as a
   subscriber's token** (any non-expired subscriber of that repo; see "Whose token") to get
   the computed `mergeable` + rollup.
4. Fan out: query `GithubSubscription` for `(repoFullName, prNumber in affected)`, push
   `pr-state` to each subscriber's live SSE stream.

If the API dies between 3 and 4, the push is lost and **that is fine**: every reconnect does
the catch-up pull, and `GithubPrState` holds the truth.

### Whose token services a delivery?

Deliveries arrive without a caller principal. REST fills during delivery use the token of
**any live subscriber of that repo**, preferring the hook's `createdBy` user. If every
candidate token is dead (revoked), the event is still recorded from the payload (state,
branch, sha — everything except computed `mergeable`/rollup) and the gap heals on the next
subscribe-pull. No delivery ever fails for lack of a token.

## Hook lifecycle

- **Create on first subscribe.** First subscription for a repo: `POST /repos/{owner}/{repo}/hooks`
  as the subscribing user, events `pull_request check_suite check_run push`, secret generated
  per repo and stored encrypted. Requires the user to be a repo admin; if GitHub answers
  404/403 on hook creation, the subscription still succeeds but is marked **poll-backed**
  (see "Fallback").
- **Reuse.** Later subscribes on the same repo (any user) find the existing `GithubRepoHook`
  row and do nothing.
- **Idle teardown, slow.** A sweeper (interval job, DB-claimed via a lease column so two
  instances never double-act) sets `idleSince` when a repo's last live subscription expires,
  and deletes the GitHub hook once `idleSince` is 24h old. Delete uses `createdBy`'s token;
  if it's dead, mark the row `orphaned` — the next subscriber on that repo reconciles
  (verifies the hook exists, recreates if not).
- **Never block a subscribe on teardown races.** Hook creation tolerates "hook already
  exists" (GitHub 422) by adopting the existing row.

## Client (harness + TUI)

### The port

`PullRequestPort` gains a pushing implementation: `SsePullRequestPort`
(`packages/harness/src/cloud/`), `pushes: true`. Constructed when the session has cloud
credentials (signed in or serve); the `gh` poller stays for signed-out sessions.

- On `read({ checkout })` / `readLinked({ repo, number })`: subscribe (idempotent), answer
  from the pull-on-subscribe response, and from then on the service's readings are fed by
  the stream.
- Heartbeats ride a single timer per session (one beat per subscription per 60s).
- The SSE client is **`@microsoft/fetch-event-source`** (as used in rs-crm): a fetch wrapper
  that runs under Bun, with response-level control so a 401 (dead cloud session) is
  distinguished from a dropped connection — 401 surfaces as `Unavailable(non-retryable)`,
  a drop reconnects with backoff and then does a catch-up pull.
- On reconnect: resubscribe (idempotent, refreshes `expiresAt`) and apply the returned
  current state before resuming the stream.

`PullRequestService` needs almost no change: `syncTimer` already skips arming the interval
for a `pushes` port, and readings arrive through the same `record` path. The subscribe/pull
plumbing lives behind the port.

### Local reading cache (instant open + /resume)

The session log already records `pull-request-linked` (`packages/core/src/events/body.ts:100`,
folded by `pullRequestsOf` in `packages/core/src/workspace/pull-requests.ts`). Add a second
event type, `pull-request-state` — declared in core's event schema beside the link event,
since all event types live in `@dltech/atlas-core` — drafted by the github plugin whenever
the tracked reading changes (turn end for the poller, each push for SSE; change-only, so a
chatty check_run stream cannot fill the log). A new plugin projection folds the latest state
per PR, exactly as `pullRequestsOf` folds links.

- `/resume` (`thread-chips.ts`) reads the projection instead of firing `gh`/API calls per
  row. Chips render instantly; a muted chip means "no state recorded," and the live source
  corrects it after open.
- The tile (`use-pull-request.ts`) seeds its first render from the same projection, so the
  sidebar shows the last-known PR state before the first subscribe response lands.

### LLM seeding

A harness-level hook (github plugin, `AfterTool`/idle-phase — placement decided in
implementation) injects a context note on PR/CI transitions for the tracked checkout:
"PR #801: checks failed on head abc123 (2 failing)" — one line, only on transitions, never
on steady state. This is harness machinery composed into every session kind, per the house
rule; the TUI does nothing special. Gated to transitions only so a chatty check_run stream
cannot spam context.

## Migration away from the app design

In the same PR series:

1. Add the new models + endpoints alongside the old module.
2. Switch the harness port to SSE; `PullRequestsClient` (`/v1/github/prs` polling) is
   deleted once nothing references it.
3. Delete `GithubAppService`, `GithubInstallationReads`, the old webhook controller/service,
   the `GithubPullRequest`/`GithubWebhookEvent` models, and the `GITHUB_APP_*` /
   `GITHUB_WEBHOOK_SECRET` env keys. The `atlas-by-dl` app's webhook URL is removed in the
   GitHub console (Dennis, manual step).
4. The existing per-repo webhook secret env key is replaced by per-repo generated secrets in
   `GithubRepoHook`.

Old webhook deliveries in flight during deploy are rejected (unknown route) and GitHub
retries them harmlessly; the first subscribe-pull after deploy re-fills state.

## Fallbacks and failure modes

| Failure | Behavior |
| --- | --- |
| Signed out | `gh` polling, unchanged (degraded mode) |
| Cloud session dead (401) | Tile shows last-known state muted; re-sign-in restores |
| User not repo admin (hook create 403/404) | Subscription marked poll-backed: the API polls GitHub as the user every 30s for that repo's subscribed PRs, pushes diffs over the same SSE stream |
| OAuth token revoked mid-session | Subscriptions keep receiving payload-derived state; computed fields gap until re-auth; next subscribe-pull fails loudly in settings |
| API restart | Stateless handler; subscriptions/hooks read back from Postgres; SSE clients reconnect + catch-up pull |
| Delivery storm (100s of check_runs) | `GithubPrState` upsert is idempotent; SSE push coalesced per PR to latest state within a 1s window |
| Multi-instance API (future) | Fan-out is in-process for now (one DO instance); the seam is a fan-out publisher interface, Neon `LISTEN/NOTIFY` when a second instance ships |

## Slices

1. **API:** schema + OAuth-scope swap + subscription/SSE endpoints + hook lifecycle + delivery fan-out + poll-backed fallback sweeper.
2. **Harness:** `SsePullRequestPort` + `@microsoft/fetch-event-source` client + port selection change + reconnect/catch-up.
3. **Harness:** local reading cache (`pull-request-state` event + projection) and LLM transition seeding.
4. **TUI:** `/resume` and tile render from the projection; signed-out path untouched.
5. **Cleanup:** delete the app module, old models, old env keys (separate PR, after 1–4 are live).

Testing: API slices are vitest unit specs (no DB in CI) plus handler-level specs with a fake
Prisma; harness slices are `bun test` with a fake SSE transport; the SSE client itself gets a
local-server spec (the repo's established pattern for network ports).
