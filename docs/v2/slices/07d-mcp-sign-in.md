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
4. Nothing in the transcript, the session events or the sandbox holds an access or refresh token.

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

## 3. Grant home — the decision this slice turns on

A cloud row is the natural home: the columns exist, Settings already lists the row as signed in, the
host already reads it, and every session of that user reuses it.

For a **repo-only server** there is no row. Two options:
- **Create a user-scope `McpServer` row on first sign-in** (recommended). It appears in Settings beside
  the others, can be disconnected there, and every future session — repo or not — reuses the grant.
  The cost is that a repo file silently adds a cloud row, so the row should record that a session
  created it.
- **Keep grants out of Settings** in a table keyed by (userId, projectId, name, url). Cleaner in theory,
  but it is a second place to show, revoke and refresh, and the precedence rules would have to learn
  about it.

Repo entries are read fresh each turn, so a grant created for one is used from the next turn without any
copying: the entry keeps its own definition and only borrows the credential.

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

## 7. Open questions

1. **Grant home for a repo-only server**: a user-scope `McpServer` row (recommended) or a separate
   grants table? The row reuses everything; a table keeps Settings clean.
2. **Callback host**: a route on the agent host (recommended, it owns the flow) or a static render of
   the same route on every host instance — it is a GET with a sealed state, so any instance can take
   it, provided the pending row is in Postgres rather than in memory.
3. **What the tool shows when no flow can start** (an unreachable authorization server, a provider that
   refuses dynamic registration): a refusal naming the reason, never a link that cannot complete.
