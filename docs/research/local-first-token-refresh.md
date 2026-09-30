# Local-first credentials: detached OAuth refresh

Research date: 2026-09-30. Atlas baseline: `305e8f87c2951808c228cf9574743947cea8ea59`;
working-tree refresh implementations inspected directly. Other local-first changes were being built
concurrently. This investigation changes no runtime files.

## Conclusion

**Copying one renewable OAuth grant into local Atlas and several detached sandboxes is not a safe
refresh-sharing contract.** With a single-use rotating issuer, even sequential refreshes fail once
one holder advances the grant. Concurrency is not required. Atlas's existing local refresher cannot
recover a successor that exists only in another detached store. A provider can also revoke the
winner's successor when it detects reuse. These are simulator results and an OAuth security model,
not a live finding about every Claude, Codex, or MCP account.

Use supported API keys or **independently authorized grant lineages per refresh owner** by default.
Local Atlas plus two detached sandboxes requires three independent lineages, not three copies,
three Atlas account IDs, or three host IDs for the same refresh token. Separate sessions for the same
provider account must be verified to remain independent; otherwise use explicitly selected,
independently authenticated accounts. Do not silently change identity or billing.

Two support issues matter independently of rotation: Anthropic does not support third-party apps
collecting/routing Claude subscription credentials; OpenAI now documents a distinct OSS Sign in
with ChatGPT flow, not reuse of Codex's hardcoded client ID. The approved local-first direction
still works, but an arbitrary copied desktop OAuth login must not be advertised as independently
renewable cloud authentication. [A1][O1][O2]

## Evidence boundaries and safety

- No real provider token endpoint was called. No real login was refreshed, imported, or revoked.
- No user's raw credential/token files, keychain entries, environment key files, or secret values
  were read or printed. Runtime imports construct only in-memory account and MCP secret stores;
  credential-source sinks are explicitly empty.
- The mandated `aws-secrets-manager` skill was requested and unavailable. No live secret operation,
  AWS call, Secrets Manager daemon access, or attempted replacement secret workflow ran.
- First-party documentation establishes supported interfaces and stated requirements. Client source
  establishes request/error-handling behavior, not a guarantee about live issuer implementation.
- The isolated executable asserts synthetic issuer behavior through actual Atlas refresh machinery.
  It does not establish real provider grace windows, family revocation, access-token invalidation,
  independently surviving logins, or inference acceptance.

## Provider findings

| Credential surface | First-party evidence | What can be concluded |
| --- | --- | --- |
| Claude subscription OAuth | Current Claude Code legal/authentication docs [A1][A2] | Third-party Claude.ai login/credential intermediation is not supported for this raw-call harness. No public subscription-token multi-holder rotation/grace contract was established. |
| Existing Codex login | Pinned OpenAI Codex client source [O6] | Refresh uses `https://auth.openai.com/oauth/token`; the client handles `refresh_token_reused`, expired, and invalidated errors and serializes within its auth manager. Client source does not guarantee independent copies are renewable. |
| OpenAI OSS Sign in with ChatGPT | Registration, sessions, token reference, VM docs [O1]-[O5] | Supported documented flow issues an app/client registration, requires per-host identifiers, replaces refresh tokens, and says to serialize the same session's refreshes. VM copying transfers one session; it does not mint another grant. |
| MCP OAuth | MCP 2025-11-25 authorization specification and RFC 9700 [M1][M2] | OAuth belongs to the MCP authorization server. The MCP text requires rotation for public clients; RFC 9700 permits sender-constrained refresh tokens or rotation. Neither offers a generic multi-holder copying guarantee. |

### Claude: technical compatibility is not provider support

Anthropic's current rule says developers interacting with Claude should use Console API keys or
supported cloud-provider authentication. It explicitly prohibits third-party developers offering
Claude.ai login in their apps and collecting, storing, or intermediating those credentials. Hosting
an **unmodified Claude Code binary**, with the end user's own login, is a separately documented
allowance. Atlas owns its loop and raw model calls; that allowance does not describe Atlas. [A1]

Claude Code documents config-directory isolation, automatic renewal, and a one-year
`claude setup-token` for unattended Claude Code use. None proves same-account grants are independent,
provides a general multi-holder refresh protocol, or grants subscription use to another harness.
A long-lived access token is not an indefinitely renewable solution. [A2]

The earlier repository note [`anthropic-oauth-transport.md`](anthropic-oauth-transport.md) records
successful inference in August and ultimately distinguishes transport compatibility from a supported
contract. Those historical calls did not test refresh sharing. The unconditional "single-use" and
"other access token revoked" statements in the inspected architecture/reconciler comments are not
independent evidence of Claude's current server behavior. No real Claude rotation experiment ran here.

For this harness, recommend API-key authentication for a supported detached Claude path. Existing
subscription mechanics can be investigated synthetically without claiming support or silently
replacing a user's chosen billing path. [A1]

### OpenAI: separate the Codex client from the documented OSS client

OpenAI's current OSS flow starts at `https://auth.openai.com/api/accounts/authorize` using
`dynamic_agent_client`, PKCE, state, nonce, `ext_agent_host_id`, and the app's actual name. The callback
returns an issued client ID. Token exchange and refresh use
`https://auth.openai.com/api/accounts/oauth/token` with that **issued** client ID and
`resource=https://api.openai.com/v1`. ID tokens must be validated and granted direct-plan scopes
checked. This is not Atlas's existing Codex device-auth implementation. [O2]

OpenAI explicitly says: "Store and use the latest replacement, and serialize refreshes for the same
session so two processes do not race a rotating token." The OSS token reference states one-hour
access tokens, 30-day refresh tokens, and a replacement with a new 30-day lifetime after every
successful refresh. These lifetimes belong to that documented flow, not necessarily every Codex
login. [O3][O4]

One issued client may be used by multiple hosts for the same user/workspace; each host has its own
stable host ID. A host ID is an identifier, not an authentication credential or a new grant. The VM
guide says to transfer protected credentials and "Let the VM own later refreshes"; it calls this a
transfer of an existing session. Do not read that as permission for the laptop and N VMs to spend
independent copies. Separate OAuth authorizations are the defensible candidate, but this task did
not verify that reauthorization with one registration preserves earlier sessions. [O1][O5]

The documentation applies to OSS and locally hosted apps; paid or remotely hosted apps are directed
to an interest form. The self-hosted VM guide is relevant to user-controlled sandboxes, but it does
not settle whether Atlas Cloud's particular hosted arrangement is covered. Confirm that before
advertising supported cloud subscription use. The preview also has its own inference restrictions,
including `store: false`, `stream: true`, and unsupported fields/tools; adopting that auth flow is
not just changing the token endpoint. [O1][O7]

At pinned Codex commit `67727e7cf114cf3e1b71db368d74b24e32f6cb12`, `auth/manager.rs` maps reused,
expired, and invalidated refresh errors separately; `oauth/client.rs` sends ChatGPT refresh as JSON.
The live server's grace/replay policy remains untested here. [O6]

### MCP: issuer-specific grants and client registration travel together

Copying an MCP token requires the matching client ID, any required client secret, scope/audience,
issuer, and resource identity. Tokens are audience-bound to their MCP server, not a generic credential
for another destination. Sender-constrained credentials may also require their proof key. A refresh
token may be absent altogether, so "OAuth configured" is not proof of unattended renewal. [M1][M2]

RFC 9700 describes rotating refresh tokens invalidating the predecessor and detecting reuse; its
security model can revoke the active successor too. This is a reason to prevent duplicate redemption,
not evidence that every deployed MCP issuer implements family revocation. Reusable-token simulation
is a control case, not a recommended public-client security policy. [M2]

Authorize each refresh owner independently using the issuer's supported client registration and
redirect arrangement. Atlas currently uses DCR; the latest MCP specification also supports
preregistration and client-ID metadata documents. Do not promise every MCP issuer works with the
existing flow. A sandbox's loopback callback belongs to that sandbox, not the laptop browser; use an
explicit supported remote authorization/transfer flow, not unattended browser fallback. [M1][O5]

## Atlas refresh machinery inspected

- [`RefreshingCredentialPort`](../../packages/harness/src/credentials/refreshing-credential-port.ts)
  has one in-flight refresh **per account ID per port instance** (lines 51, 126-135). It persists the
  replacement before returning it (160-169). On hard 400/401/403 it rereads **its own account store**
  and accepts a changed pair, otherwise marks the account expired (172-209).
- [`SinkReconciler`](../../packages/harness/src/credentials/sink-reconciler.ts) reads/writes the
  imported tool's locally available sink (49-89). It uses expiry-based adoption, not a distributed
  lock or grant generation. This cannot reconcile detached machines or fence a concurrent refresh.
- [`AccountStore`](../../packages/harness/src/credentials/account-store.ts) serializes writes within
  one store instance (147-153). Atomic file rename prevents partial files; it does not make a
  read-network-refresh-write transaction atomic across processes or machines.
- [`AnthropicOauthClient`](../../packages/harness/src/credentials/oauth/anthropic-oauth-client.ts)
  requires both returned access and refresh tokens (118-121).
  [`CodexOauthClient`](../../packages/harness/src/credentials/oauth/codex-oauth-client.ts) replaces a
  returned refresh token or retains the old token when omitted (106-136). Both accept injected fetch
  and clock, so the spike tests their actual serialization and parsing without live calls.
- [`McpOAuthFlow`](../../packages/harness/src/mcp/oauth/flow.ts) has no refresh single-flight. On any
  token-refresh exception, including a transport error, it clears tokens (141-170). `currentToken`
  returns `undefined`, without opening a browser (64-70). A losing refresher can clear a winner's
  newly saved tokens when they share a store.
- [`McpOAuthStore`](../../packages/harness/src/mcp/oauth/token-store.ts) persists tokens **and** client
  registration in a URL-keyed secret blob. Its low-level refresh keeps the previous refresh token
  if omitted from the response ([`token.ts`](../../packages/harness/src/mcp/oauth/token.ts):184-214).
- At baseline `305e8f87c2951808c228cf9574743947cea8ea59`, serve bound broker-backed account,
  credential and secret ports. The local-first implementation replaces them with persistent local
  stores; merely copying access tokens would not provide detached renewal.
- The baseline API broker refreshed before its `secretVersion` compare-and-swap. Inspect it with
  `git show 305e8f87c:apps/api/src/api/platform/accounts/broker.service.ts`. Post-refresh CAS protects
  the stored row, not the token's prior redemption, so it cannot serve as a global rotation lock.
  The local-first implementation removes that broker and its model-token routes entirely.

## Executable verification: simulator, not live providers

[`local-first-token-refresh.ts`](../../packages/harness/spikes/local-first-token-refresh.ts) constructs
in-memory stores and a self-terminating `Bun.serve` issuer on `127.0.0.1`, port zero. Injected fetch
reroutes only the two known provider token URLs to that issuer and rejects other destinations; MCP
uses its loopback discovery metadata. Only `fake:` refresh tokens are accepted. No Atlas API, CLI
credential import, filesystem vault, or real browser is involved. The probe ran on the host as a
short-lived isolated program, not an application/dev server.

Actual `RefreshingCredentialPort` + Anthropic/Codex clients and `McpOAuthFlow` + token store were
exercised. A request barrier forces concurrent requests to use the predecessor before either returns;
there are no sleeps. A controlled response-loss branch consumes the successful issuer response,
then throws before Atlas receives it.

| Asserted scenario | Observed result |
| --- | --- |
| Two detached copies, sequential | One renewal succeeds; the other cannot refresh. Provider account becomes expired; MCP drops its tokens. |
| Two detached copies, concurrent | Exactly one usable result; exactly one `invalid_grant` refusal. |
| Reuse revokes family | Winner's next renewal fails too. This is an explicit simulator policy. |
| Independent local + two sandbox grants | All three renew twice: six accepted exchanges, zero refusals. |
| Explicit reusable issuer | Both detached copies renew. Sharing outcome depends on issuer policy. |
| Rotation response lost | Provider retry spends predecessor and fails; MCP already cleared its tokens and does not retry. No copy can recover the lost successor. |
| Concurrent reads on one port/flow | Provider port coalesces to one exchange; MCP flow sends two, and one loses. |
| Shared store, refusal delayed until winner persisted | Provider reread recovers the winner; MCP loser clears the shared winner's tokens. |
| Serialized reread of shared latest state, three holders | All three get usable credentials over two cycles, with two exchanges and no reuse, even under family-revocation policy. |

**27 scenarios passed**, nine for each protocol, on Bun 1.4.2. The coordination test is a single-process
queue over shared memory, not a deployed distributed-lock implementation. It demonstrates the required
serialization + reread invariant, not crash safety, network partitions, multi-process filesystem
locking, or provider idempotency. The independent-grant test gives the simulator different lineages;
it does not prove a real provider preserves multiple grants for the same identity.

Reproduce from the repository root:

```bash
ATLAS_TESTING=1 bun run packages/harness/spikes/local-first-token-refresh.ts
```

Standalone strict typecheck also passed. Run from `packages/harness` because Bun's isolated linker
keeps its type package there; this spike is outside the normal `src`/`scripts` tsconfig inclusion:

```bash
../../node_modules/.bin/tsc --ignoreConfig --noEmit --target ES2023 --lib ES2023 \
  --types bun --module Preserve --moduleResolution bundler --strict \
  --noUncheckedIndexedAccess --noImplicitOverride --exactOptionalPropertyTypes \
  --verbatimModuleSyntax --skipLibCheck spikes/local-first-token-refresh.ts
```

Initial typecheck attempts from the root failed to resolve Bun types; the package-scoped attempt
needed TypeScript's `--ignoreConfig` when passing a standalone file. Those invocation errors were
corrected; the final strict check exited zero. No repository-wide suite or live-cloud round-trip ran.

## Recommendation for local-first lift

**Immediate runtime guard:** classify each lifted credential as supported reusable, verified
independent grant assigned to one owner, or explicitly coordinated. Treat an ordinary copied OAuth
snapshot as unknown/shared, not independently authorized. Refuse a detached lift requiring that
credential before starting the sandbox, with a visible remedy (supported API key, independent
credential, or configured authority). Do not silently disable refresh and let it fail at expiry.
A new Atlas account ID, `origin=login`, or a different host ID is not evidence of grant independence.

A direct terminal/serve channel can carry coordinated credential reads without the Atlas API, but
all readers must use one durable refresh authority. If that authority is the terminal, require a
connected-only mode and clearly refuse detachment. If it is one surviving sandbox, local and sibling
sandboxes must reach it for renewal; do not promote another owner on timeout and race the old one.
This is a separate availability/topology choice, not a fix inherent in portable snapshots.

1. **Keep local stores canonical for user configuration and explicit cloud backup.** Backup is a
   snapshot, not a refresh owner or a live synchronization/coordination mechanism. Never restore a
   predecessor over a current grant simply because the backed-up account ID matches.
2. **Copy refreshable credentials with an explicit owner.** API keys are copyable within the owner's
   authorized usage; independently granted OAuth credentials are assigned to local or one sandbox.
   A sandbox's grant can be prepared locally, securely copied during lift, then refreshed only by
   that sandbox. The locally retained seed is not an active refresh credential. Preserve the
   sandbox's latest pair on durable storage across restart and descend; stale image/backup replay
   must not overwrite it. Distinguish holder-owned evolving token state from canonical local config.
3. **Support local + N detached sandboxes with N+1 independent grants or supported API keys.** Require
   an explicit credential choice before lift, not a blanket desktop-vault clone. For existing Codex
   and MCP OAuth, independent accounts are the conservative option until same-account independent
   sessions are verified. New OpenAI OSS OAuth is a supported-flow candidate subject to hosting
   eligibility and the separate adapter work; Claude subscription cloning is not a supported fix.
4. **If one rotating grant must be shared, require real coordination outside the Atlas API.** One
   durable authority must serialize read-current → refresh → persist-replacement for that lineage;
   all holders consume its latest state, and nonparticipants (including the provider CLI) cannot
   continue refreshing the seed. A lock without shared latest state, post-refresh CAS, expiry
   staggering, periodic backup, or a local-only lock is insufficient. A laptop coordinator that goes
   offline does not satisfy detached cloud operation. An always-reachable, user-controlled authority
   changes infrastructure and is an explicit alternative, not an invisible dependency.
5. **Fail explicitly rather than silently strand cloud.** No refresh token, unsupported issuer flow,
   uncertain grant independence, unavailable coordinator, terminal refresh error, and response-lost
   rotation need actionable status naming the affected account/MCP server and owner. Preserve
   temporary-failure state; do not treat every network failure as revocation. Do not start a browser
   automatically in a detached sandbox or silently fall back to another account or API billing.

Even coordination cannot make provider rotation and local persistence one atomic transaction. A
crash or lost response between them needs provider-supported recovery/idempotency, or explicit
reauthorization. Do not claim otherwise. Exclusive grant transfer is another valid option, but it
stops local use of that **same grant** and does not solve local + N independent owners by itself.

Before declaring a provider's same-account multi-grant path verified, use a separately approved,
disposable test identity and protected execution tooling: authorize three distinct sessions, renew
all across several cycles, restart from current storage, test documented reuse/error recovery and
cloud API unavailability. Do not perform that test with copied daily-driver credentials. No such
verification was possible or attempted under this task's safety constraints.

## Primary sources

- [A1] [Claude Code: legal and compliance](https://code.claude.com/docs/en/legal-and-compliance),
  “Authentication and credential use” and “Can customers offer Claude Code in their products?”.
- [A2] [Claude Code: authentication](https://code.claude.com/docs/en/authentication), credential
  management, account isolation, unattended expiry, and long-lived tokens.
- [O1] [OpenAI: OSS ChatGPT plan usage overview](https://developers.openai.com/siwc/token-sharing-open-source),
  hosting boundary and client vs. host identity.
- [O2] [OpenAI: registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
  issued client IDs, PKCE, host ID, validation, endpoints, and atomic protected storage.
- [O3] [OpenAI: accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions),
  “Refreshing tokens”.
- [O4] [OpenAI: token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference),
  replacement refresh tokens and documented lifetimes.
- [O5] [OpenAI: self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms),
  transfer of an existing session and VM ownership of later refreshes.
- [O6] OpenAI Codex commit `67727e7cf114cf3e1b71db368d74b24e32f6cb12`, dated 2026-09-30:
  [`auth/manager.rs`](https://github.com/openai/codex/blob/67727e7cf114cf3e1b71db368d74b24e32f6cb12/codex-rs/login/src/auth/manager.rs)
  and [`oauth/client.rs`](https://github.com/openai/codex/blob/67727e7cf114cf3e1b71db368d74b24e32f6cb12/codex-rs/login/src/oauth/client.rs).
- [O7] [OpenAI: preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
  and [errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery).
- [M1] [MCP authorization specification, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization),
  roles, client registration, resource binding, and “Token Theft”.
- [M2] [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html), sections 2.2.2 and 4.14.2,
  public-client refresh protection, invalidation, replay detection, and family revocation.
