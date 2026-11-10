# Slice 7d spec: MCP sign-in from the transcript

Status: **spec, 2026-11-10.** Nothing is built. Anchors are `path:line` at `a066c30b5`; re-check
before relying on one. Prior slice: [07b-mcp-skills.md](07b-mcp-skills.md) — its §9 records the two
cloud servers this slice is about.

## Goal

A session that finds an MCP server needing a sign-in can say so and hand the operator a link, in the
transcript, that finishes the sign-in — no token typed into the chat and none left in the sandbox.

**Exit criterion:**
1. In a live v2 session, `mcp_sign_in` on a server whose row has no grant returns a URL as its result;
   the operator opens it, approves at the provider, and the next turn's roster shows the server
   `connected` with its tools offered.
2. The same works for a server only the repo names (a `.mcp.json` or `.atlas/mcp.json` entry with no
   cloud row): the tool starts the flow for that entry, and after approval the entry connects.
3. A grant that expires is refreshed by the session itself, with no second operator action.
4. A repo-declared server's grant sits on its `source = 'repo'` row, keyed by `(userId, 'repo', name)`
   with its `repoUrl`, and Settings lists it beside the cloud rows.
5. Nothing in the transcript, the session events or the sandbox holds an access or refresh token.

## 1. What exists today

- **v1 has the whole flow.** `apps/api/src/api/cloud/mcp-oauth/` (~2.9k lines with specs):
  protected-resource and authorization-server discovery (`mcp-oauth-discovery.ts`, guarded by
  `mcp-oauth-ssrf.ts`), dynamic client registration and reuse (`mcp-oauth-client-reuse.ts`), PKCE and
  the authorize URL (`mcp-oauth.service.ts:102`), a pending record sealed into
  `public.McpOauthPending`, a public `GET callback` (`mcp-oauth-callback.controller.ts:17`), the code
  exchange, the grant sealed onto the row (`mcp-oauth-seal.ts`), and refresh behind a Redis lock
  (`mcp-oauth-access.service.ts:63-80`). Its tRPC router exposes `begin`, `disconnect`, `forget`,
  `servers` and a `podReachable` `accessToken` (`mcp-oauth.router.ts:35-90`) — the last is how a v1
  sandbox asks the API for a token.
- **v2 reads grants but cannot create one.** Since #2168 the agent host unseals
  `public.McpServer.oauthSealed` and the http transport sends the bearer
  (`apps/agent-host/src/config/mcp-servers.ts`, `plugins/mcp/src/pod/http.ts`). A row with no grant
  answers `needs-auth`, and nothing in v2 can change that.
- **The pod cannot ask a human anything mid-call.** There is no elicitation seam: `operator_input`
  waits on the same missing piece ([07c](07c-native-tools.md) §).
- **v1 already models a repo server as a row.** `public.McpServer.source` is `cloud | repo`; a repo row
  carries `repoUrl` and `lastSeenAt` instead of a sealed spec, and its grant is sealed onto that same
  row by the OAuth store (`touchRepoServer`, `writeGrant`). What v2 lacks is only the read of those
  rows and a way to create one.
- **The tables are there.** `public.McpServer` already carries `oauthStatus`, `oauthServerUrl`,
  `oauthSealed`, `oauthGeneration`, `oauthRefreshAttempt`, `oauthRefreshStartedAt` and
  `oauthUpdatedAt`; `public.McpOauthPending` holds a sealed in-flight flow keyed by user and server
  (`packages/db/src/prisma/schema/user-config/mcp-oauth-pending.prisma`).
- **v2 owns its work.** The host reads Postgres itself and calls the API for nothing
  ([0027](../decisions/0027-both-backends-own-their-work.md)); it is a public long-lived server at
  `agent.byatlas.io` ([/healthz]), so it can host the callback. v2 shares no logic with v1: the flow is
  ported, not imported.

## 2. Shape

Three pieces, each where it belongs:
1. **A pod tool, `mcp_sign_in { name, url? }`** in `plugins/mcp`. It resolves the entry (cloud row or
   repo file, by the same precedence the store already loads), asks the host for an authorize URL
   through a new `PodControl.mcpSignIn` port, and returns a sentence plus the URL as the tool's text.
   A URL is the one thing the operator has to act on, so it goes in the result the transcript shows;
   nothing else does. Effect `Write` (it makes a network call and writes a row), not `Destructive`.
2. **The host owns the flow**, in a new v2 module (e.g. `apps/agent-host/src/mcp-oauth/`), reusing the
   row columns above and the pending table: discovery, registration, PKCE, authorize URL, and the code
   exchange. The port answers in-process, so the pod never calls the API.
3. **A public callback on the agent host**, `GET /mcp-oauth/callback?state=&code=`, validating the
   sealed pending row and redirecting to the web (`/settings/integrations`) the way v1 does
   (`mcp-oauth-redirect.ts`). The redirect URI must be registered with the provider at client
   registration time, so it is fixed and configurable per tier.

The transcript flow is therefore: tool result carries the link → the operator approves in a browser →
the callback seals the grant → the next turn's reconcile connects the server and its tools appear,
exactly as they did for `Posthog` once its grant existed.

**Rejected for now:** a device-code or paste-into-the-chat flow. MCP authorization servers standardise
authorization code + PKCE with a redirect URI, not device codes, and a paste path needs the elicitation
seam this slice does not build. If a needed server turns out to be device-code only, that is a
follow-up.

## 3. Where a grant lives — already decided by v1's table

There is no new decision to make here: the table already carries repo-scoped servers.
`public.McpServer.source` is `cloud | repo` (`packages/db/src/prisma/schema/user-config/mcp-server.prisma`),
keyed by `(userId, source, name)` and `(projectId, source, name)`, so a repo entry and a cloud row may
share a name. A repo row is defined by its URL rather than by a spec — the check constraint
`McpServer_fields_by_source` requires `repoUrl IS NOT NULL AND lastSeenAt IS NOT NULL` exactly when
`source = 'repo'` — and the grant columns are the same ones, so a repo server's grant lives on its repo
row (`prisma-mcp-oauth.store.ts:136-168` `touchRepoServer`, `:169` `writeGrant`).

What this slice adds on the v2 side is only that reading:
- **The host reads both sources.** `apps/agent-host/src/config/mcp-servers.ts` filters
  `source: 'cloud'` today; it also selects `source: 'repo'` rows for the user and the project, and the
  plugin matches them to the repo entry by name and `repoUrl`, so a repo entry keeps its own definition
  (command, headers, disabled stub) and takes only the credential from the row.
- **Signing in touches the row.** A repo entry with no row gets one the way v1 creates it
  (`touchRepoServer`: `repoUrl` = the entry's URL, `lastSeenAt` = now, id `rmcp_…`), then the grant is
  sealed onto it; a later load bumps `lastSeenAt` when it is stale, so a row nothing has seen is
  identifiable and sweepable.
- **Settings stays one list.** A repo-signed-in server appears there beside the cloud rows, marked by
  its `repo` source, and disconnect works on the same row.

## 4. Refresh

A grant carries `tokens.refreshToken` and `tokens.expiresAt`. When the access token is expired or a
request answers 401, the host refreshes it against `tokenEndpoint` and seals the new grant.
- Single-flight across hosts without Redis: a conditional update on the row (`oauthRefreshStartedAt`,
  `oauthGeneration`) claims the refresh; a host that loses the claim re-reads the row and uses the new
  token. `mcp-oauth-access.service.ts` is the reference for the semantics, not a dependency.
- A refresh that fails terminally sets `oauthStatus = expired`, so the roster says `needs-auth` again
  and `mcp_sign_in` is the way back.

## 5. Test plan

- **Pure** (a v2 core module): discovery document parsing and rejection, PKCE challenge derivation,
  state validation (unknown, mismatched user, expired, server changed), the authorize URL's parameters,
  and the refresh claim decision.
- **Host**: begin writes a sealed pending row and answers a URL; a callback with a bad state or a
  mismatched user refuses and seals nothing; a good callback seals the grant onto the row; a second
  refresh attempt during an in-flight one waits and then uses the winner's token.
- **Pod**: `mcp_sign_in` names the entry, passes the name through the port, and returns the URL in its
  text; an entry that does not exist, or one already connected, answers without a URL; a `needs-auth`
  row's roster reason points at the tool.
- **Live**: criterion 1–4 above, in one fresh session, recorded in §8.

## 6. Out of scope

- Elicitation and any in-transcript token entry (`operator_input` and `operator_shell_input` keep
  waiting on that seam).
- Per-tool approval, and any MCP write tools v1 does not have.
- Reusing `apps/api`'s OAuth code or calling it: the flow is v2-native so it survives slice 10.
- Signing out from the transcript (`mcp_sign_out`): Settings' disconnect is enough for now.
- Refresh for a grant whose refresh token the provider no longer honours — that is a sign-in again.

## 8. Live check (2026-11-10, production)

Run on the deploy of `7dc9805eb` (`agent.byatlas.io` live from 16:05Z), in a fresh v2 session
(`7b68c42c…`) whose clone carried one repo-only http server in `.mcp.json`:
`{"mcpServers":{"posthog-live":{"url":"https://mcp.posthog.com/mcp"}}}` — no cloud row for it at all.
1. `mcp_sign_in {"name":"posthog-live"}` answered `Open this link to sign in to the posthog-live MCP
   server: https://oauth.posthog.com/oauth/authorize/?…` — a real authorize URL carrying a registered
   `client_id`, `code_challenge` with `S256`, `redirect_uri=https://agent.byatlas.io/mcp-oauth/callback`
   and a sealed `state`, plus Posthog's scope list.
2. The host created the row before the redirect: `posthog-live | source = repo |
   repoUrl = https://mcp.posthog.com/mcp | lastSeenAt set | no grant`, and one `McpOauthPending` row
   bound to it, unexpired.
3. The link was approved in a browser. The callback consumed the pending row (0 left), sealed the
   grant on the same row (`oauthStatus = active`, `oauthGeneration = 1`, `oauthUpdatedAt` 16:07:08Z),
   and redirected — **to global Settings, not to the session**, which is the defect §9 records.
4. The next turn's roster read `posthog-live | http | connected | 1 tool | layer project` beside
   `Posthog | connected | 1` and `wispr-flow | needs-auth | 0`, whose reason now reads `the
   'wispr-flow' MCP server needs a sign-in; call mcp_sign_in to start one`.

So the slice's exit criteria 1–2 and 5 hold for a repo-only server end to end, and the tool is what a
model reaches for when the roster says `needs-auth`. Criterion 3 (refresh) is covered by specs only:
two concurrent refreshes make one token call, but no expired grant was refreshed live.

The row and grant created by this check were deleted afterwards, so nothing about it is left in the
account.

## 9. What this check found

Two defects, both from v1 features this port dropped, each with its own handoff:
- **The callback returns to Settings, never to where the flow started.**
  `apps/agent-host/src/mcp-oauth/store.ts:50` hardcodes `returnSurface: 'web'` and
  `sealedPendingSchema` (`types.ts:55`) carries no `returnTo`, no surface and no session, so the
  callback can only fall back to `/settings/integrations`. v1 took `returnTo` and `surface` on `begin`
  and had a desktop branch. The fix is a return target of **surface × screen** (`web | desktop | ios`
  by `session:<id> | settings:user | settings:project:<id>`), recorded in the pending row — the
  server-side equivalent of the cookie `callback.byatlas.io` uses — plus the `atlas://` deep link for
  the apps and a Settings-initiated `begin` for the settings entry points.
- **The authorize URL is the tool's result text.** It is a screenful of percent-encoded scopes. It
  should be two events (`mcp-sign-in-started`, `mcp-sign-in-resolved`) rendered as a card in the
  transcript, with the tool's text reduced to one line — the shape `operator_input` already uses, and
  the event log stays the only source of truth the custody of this is a fold over.

## 7. Open questions

1. **Callback host**: a route on the agent host (recommended, it owns the flow) or a static render of
   the same route on every host instance — it is a GET with a sealed state, so any instance can take
   it, provided the pending row is in Postgres rather than in memory.
2. **What the tool shows when no flow can start** (an unreachable authorization server, a provider that
   refuses dynamic registration): a refusal naming the reason, never a link that cannot complete.

## 8. Return target (2026-11-10)

**Settled:** open question 1 above. The callback stays on the agent host, and it now returns to the
screen the flow started from instead of global Settings.

### The model

```ts
type McpReturnSurface = 'web' | 'desktop' | 'ios'
type McpReturnScreen =
  | { kind: 'session'; id: string }
  | { kind: 'settings'; scope: 'user' }
  | { kind: 'settings'; scope: 'project'; id: string }
```

`sealedPendingSchema` carries `returnTarget: {surface, screen}` in the sealed blob — the callback's
only tamper-proof record, since the vendor's redirect carries nothing of ours. The row's existing
`returnTo` (`/sessions/<id>`, `/settings/integrations`, `/projects/<id>/settings/mcp`) and
`returnSurface` columns are written from it too, as the fallback when a blob will not unseal.

### Where a surface comes from

- The client declares it on the stream `hello` (`{type:'hello', v, token, surface?}`, optional;
  `EStreamSurface`). Web sends `desktop` when the Mac bridge is present and `web` otherwise; the iOS
  app sends `ios`.
- One connection serves many sessions, so the host records the surface when a session subscription
  opens: `UPDATE v2."V2Session" SET "lastSurface" = $1 … WHERE lastSurface IS DISTINCT FROM $1`,
  default `web`. `McpOauthService.begin` reads it through `apps/agent-host/src/config/mcp-control.ts`,
  which is already per session.

### Two entry points, one begin

- **The tool.** `mcp_sign_in` → `PodControl.mcp.begin({name, source, url})` → the adapter adds
  `{surface: lastSurface, screen: {kind:'session', id: sessionId}}`. The port signature did not change:
  `control.of(sessionId)` already scopes it to one session, so no pod fake moved.
- **Settings.** `POST /mcp-oauth/begin` on the host, `{serverId, surface, screen}`, bearer = the same
  session token the stream uses. The route resolves the row by id (never a client-supplied URL),
  checks the caller owns the user row or the project, checks a project screen's owner, then calls the
  same begin. CORS mirrors the origin under the websocket's rule (a host with `TRUSTED_ORIGINS` unset
  accepts any origin; the bearer, not the cookie, is the boundary). The web settings pages call it
  from `beginMcpSignIn` (`apps/web/src/features/settings/data/shared/mcp-signin-request.ts`); sign-out
  and listing stay on the API for now.

### The mapping

| surface   | screen   | answer                                                                                                     |
| --------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `web`     | any      | 302 `${webOrigin}${path}?mcpOauth=&mcpServer=&mcpReason=`                                                  |
| `desktop` | any      | HTML: `location.href = atlas://open${path}${search}`, with the web URL as a "Continue in the browser" link |
| `ios`     | session  | HTML: `atlas:///sessions/<id>${search}` — the shape `apps/mobile/src/navigation/destination.ts` parses     |
| `ios`     | settings | 302 to the web URL: the iOS app registers no settings route, so it stays in the browser                    |

Failures (`unknown_state`, `expired`, `session_mismatch`, `server_changed`, `missing_code`,
`exchange_failed`, a provider error) take the same path, so an expired state names its reason on the
screen the flow started from. An unknown state has no row to read, so it lands on the user settings
page.

### Verified locally

- `apps/agent-host`: `bun test` (1013 tests) and cold `bunx tsc --noEmit --incremental false`.
  New: `redirect.spec.ts` (every surface × screen, escaping, reason length), `begin-route.spec.ts`
  (bearer, origin, ownership, project screen, repo row), and callback cases for each screen, the
  desktop/ios pages, an expired state on its own screen and an unknown state on settings.
- `apps/web` (2212), `packages/client` (789), `packages/protocol` (201), `plugins/mcp` (54),
  `packages/db` v2 smoke: green, each cold-typechecked.
- Migration `20261110T1637_mcp_session_surface` adds `v2."V2Session"."lastSurface" text NOT NULL
  DEFAULT 'web'`; the db `refs/db.json` is at its hash.

### Live run (2026-11-10, host at `0848daefb`)

Against `agent.byatlas.io` once the merge deployed, with a temporary `AuthSession` for the operator's
user (removed afterwards):
- `POST /mcp-oauth/begin {serverId: the wispr-flow row, surface: 'web', screen: {kind:'settings',
  scope:'user'}}` answered a real wispr-flow authorize URL; the pending row read
  `returnTo=/settings/integrations, returnSurface=web`; the callback without a code answered
  `302 https://byatlas.io/settings/integrations?mcpOauth=failed&mcpServer=…&mcpReason=missing_code`.
  (The web origin is `https://byatlas.io`: the production host runs with `TRUSTED_ORIGINS` unset, so
  the callback's `webOrigin` falls back.)
- The same with `surface: 'desktop', screen: {kind:'session', id:'ses_live_check'}` answered a page
  whose script opens `atlas://open/sessions/ses_live_check?mcpOauth=failed&…` and whose body carries
  the web fallback; `surface: 'ios'` gave `atlas:///sessions/ses_live_check?…`.
- A project screen the caller does not own answered `403`; a request with no bearer answered `401`.
- A fresh v2 session in the atlas project was subscribed to over the stream with `surface: 'desktop'`;
  `v2."V2Session"."lastSurface"` then read `desktop`. Its roster showed `wispr-flow` as needs-auth, so
  asking it to sign in made the model call `mcp_sign_in {name:'wispr-flow'}`; the tool result carried
  the authorize URL, and the pending row it wrote read `returnTo=/sessions/<that id>,
  returnSurface=desktop`. That state's callback opens `atlas://open/sessions/<that id>?…` (exercised
  without a code, so on the failure path). The session was archived and its token deleted.

Not exercised live: approving at the provider (interactive login) and so the grant landing and the
roster flipping on the next turn; the Mac app opening the deep link; iOS on a simulator.
