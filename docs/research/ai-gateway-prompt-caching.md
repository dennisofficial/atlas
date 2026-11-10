# Anthropic manual caching and DeepSeek automatic caching through Vercel AI Gateway

Research date: 2026-11-10. Primary sources: Vercel AI Gateway docs (page `last_updated` quoted per
claim) and the installed `@ai-sdk/gateway@4.0.125` (`packages/harness/package.json:27`,
`apps/agent-host/package.json:18`), whose `docs/00-ai-gateway.mdx` is the AI SDK provider reference
for AI Gateway. DeepSeek's own API docs are used only for its server-side cache semantics.

Motivation: on the DeepSeek route (`deepseek/deepseek-v4.1-flash-1017-fast`), per-call prompt-cache
reads flicker inside a single turn on a prompt that only grows; cold calls prefill the whole prompt.
On the Anthropic route caching is near-perfect. Atlas sends explicit `anthropic.cacheControl`
breakpoints for Anthropic models (`packages/core/src/assembly/annotators/cache-breakpoints.ts:13-58`)
and nothing but `gateway.caching: 'auto'` for every gateway model
(`apps/agent-host/src/model/providers/gateway-model.ts:12-14`).

## 1. Does AI Gateway cache prompts itself?

No. The Gateway is a router and a marker translator; the cache entry lives at the upstream provider,
on the provider account that served the request.
- "**Default behavior**: When `caching` is not set, AI Gateway passes your request through without
  modification. Providers with implicit caching still cache automatically. For Anthropic, you'll need
  to set `caching: 'auto'` or manually add cache markers to your messages."
  — https://vercel.com/docs/ai-gateway/models-and-providers/automatic-caching (2026-09-11)
- "For providers with implicit caching (OpenAI, Google, DeepSeek), no modification is needed and
  caching works automatically."
  — same page
- "A provider's prompt cache lives on the provider account that served your request. When the next
  request in a conversation goes somewhere else, that cache is cold and you pay full price for the
  prompt again."
  — https://vercel.com/docs/ai-gateway/models-and-providers/session-affinity (2026-10-13)

Every caching lever the Gateway documents is either a marker it injects into the upstream request
(`cache_control`, `cache_ttl`, `cache_anchor_items`) or provider-side behaviour it leaves alone.
Neither page, nor the overview at https://vercel.com/docs/ai-gateway, claims a Gateway-side prompt
cache. Note the docs never state the negative aloud — "AI Gateway does not cache prompts" appears
nowhere; the conclusion is from the described model, not a quoted sentence.

## 2. How explicit (Anthropic) caching works through the Gateway

Documented as supported, and the `anthropic` provider-options key is the documented mechanism:
- "**AI SDK**: Use the `cacheControl` property on messages." listed under **Manual caching** for
  Gateway traffic — https://vercel.com/docs/ai-gateway/models-and-providers/automatic-caching
- A 1-hour TTL is read from that same key by the Gateway's own routing layer: "**Anthropic models:** a
  1-hour cache lifetime, set with `cacheControl.ttl: '1h'` in the AI SDK, `cache_control.ttl: '1h'`
  on Anthropic Messages, or `cache_ttl: '1h'` with `caching: 'auto'`"
  — https://vercel.com/docs/ai-gateway/models-and-providers/session-affinity

So the Gateway parses `providerOptions.anthropic.cacheControl` (including `ttl`) itself, for routing
decisions as well as for the upstream request. Nothing else is documented as required: no Gateway
provider-options flag, no `anthropic-beta` header, no special base path. Manual markers are described
as the alternative to `caching: 'auto'`, not as something `caching: 'auto'` must accompany.

The SDK does no translation of its own: `@ai-sdk/gateway` forwards the model call arguments verbatim
as the request body to `https://ai-gateway.vercel.sh/v4/ai/language-model`
(`src/gateway-language-model.ts:92` `body: args`; `packages/harness/src/providers/__tests__/gateway-adapter.spec.ts:55`
pins that URL). Per-part and request-level `providerOptions` therefore travel to the Gateway unmodified
and are interpreted server-side. There is no `cacheControl` handling anywhere in the package
(`grep cacheControl src/` → no hits), which matches observed behaviour: our Anthropic route gets near-perfect
cache reads with type-identical payloads, so the server side does honour them.

## 3. Can the Gateway preserve an automatic (DeepSeek) server-side cache?

Partly, and the granularity is the problem. Vercel documents conversation affinity with an explicit
and important caveat about what gets pinned.
- Session affinity "is on by default for text and chat requests"; the Gateway groups requests into a
  session, "remembers which provider served the session's last request, and tries that provider first
  on the next one".
- Pin scope: "**Pin the provider.** When a provider accepts a request, AI Gateway saves that provider
  as the session's pin for the model that served the request. **For session IDs you send and for
  Claude Code sessions, the pin also names the exact credential, because each account keeps its own
  cache.**"
- Without an explicit id: "AI Gateway derives one from the conversation itself … **Fingerprinted
  sessions pin only the provider, not the credential**, because unrelated users can share the same
  opening."
- Fingerprint inputs are hashed (SHA-256, with team id) from "the first system or developer message",
  "the first message that isn't a system or developer message" and "the set of tools, including each
  tool's name, description, and schema", capped at 4,096 characters per message.
- Fingerprints pin "only for models that support prompt caching, and only when the prompt is large
  enough to cache"; pin lifetime defaults are OpenAI/Azure 10 min, **DeepSeek 1 hour**, all others
  5 min, and "A pin never lasts longer than 1 hour".
  — all from https://vercel.com/docs/ai-gateway/models-and-providers/session-affinity

Routing is therefore _not_ documented as deterministic in the sense of "always the same upstream
account". The docs state plainly that a cache belongs to the account, and that a pin only covers the
account when the session id is explicit. They do **not** say the Gateway rotates provider accounts or
regions per request; they leave the credential as a routing dimension that a fingerprint-only session
does not constrain. For a single-provider-slug model such as `deepseek/…`,
promoting "the pinned provider to the front" is a no-op, so the only remaining routing freedom is the
credential — which is exactly the dimension that a fingerprinted session does not pin.

Two secondary constraints that also break automatic prefix caches:
- Any change to the first system message, first non-system message, or the tool set changes the
  fingerprint, which starts a new session and so a new (unpinned) routing decision.
- Providers with implicit caching are cached by the provider itself, best-effort. DeepSeek: "The
  cache system works on a 'best-effort' basis and does not guarantee a 100% cache hit rate" and "A
  subsequent request can only hit the cache if it **fully matches** a **cache prefix unit**", with
  units persisted at request boundaries, at detected common prefixes, and "at fixed token intervals"
  for long inputs — https://api-docs.deepseek.com/guides/kv_cache/

## 4. Routing controls and what actually pins a request

Exact names and accepted values, from `GatewayProviderOptions` exported by `@ai-sdk/gateway@4.0.125`
(`dist/index.d.ts:21-97`, mirrored in `docs/00-ai-gateway.mdx` "Gateway Provider Options"):

| option                                                                                                                              | type                                                                                                                                     | effect                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `order`                                                                                                                             | `string[]` (provider slugs)                                                                                                              | attempt order; pinned provider is promoted ahead of it by session affinity |
| `only`                                                                                                                              | `string[]` (provider slugs)                                                                                                              | hard allowlist; no fallback outside it                                     |
| `sort`                                                                                                                              | `'cost' \| 'tps' \| 'ttft'`                                                                                                              | rank providers before routing                                              |
| `models`                                                                                                                            | `string[]`                                                                                                                               | fallback models (decision requests may start with `{ model, when }`)       |
| `has`                                                                                                                               | `Array<'implicit-caching' \| 'reasoning' \| 'structured-output' \| 'tool-use' \| 'vision' \| \`quantization:…\` \| \`!quantization:…\`>` | capability filter on provider models                                       |
| `caching`                                                                                                                           | `'auto'`                                                                                                                                 | Gateway injects provider-native cache markers                              |
| `byok`                                                                                                                              | `Record<string, Array<Record<string, unknown>>>`                                                                                         | request-scoped provider credentials                                        |
| `disallowPromptTraining`, `zeroDataRetention`, `serviceTier`, `tags`, `user`, `quotaEntityId`, `providerTimeouts`, `idempotencyKey` | as typed                                                                                                                                 | policy/telemetry knobs                                                     |

Documented by Vercel but **not declared in the installed package's types**:
`providerOptions.gateway.sessionId` (opaque id, ≤256 chars; also settable as the `session_id` body
field or the `x-session-id` / `x-session-affinity` header) and
`providerOptions.gateway.sessionAffinity` (`false` to opt out; default `true`). `GatewayProviderOptions`
has an open `[key: string]: unknown` for "Service-owned options … The Gateway service validates and
applies the runtime schema", and `grep sessionId|sessionAffinity dist/index.d.ts dist/index.js src/`
returns nothing, so neither name is type-checked client-side in 4.0.125. Sources:
https://vercel.com/docs/ai-gateway/models-and-providers/session-affinity,
https://vercel.com/changelog/ai-gateway-logs-now-show-session-affinity.
A related control exists but was not verified: `inferenceRegion`
(https://vercel.com/docs/ai-gateway/security-and-compliance/regional-inference).

**`sessionId` is the only documented lever that pins the credential.** `order`/`only`/`sort` pin a
provider slug, not an account. The Gateway also reads `prompt_cache_key` as a session source (priority
4 in that page's list) — the same parameter Atlas already sets for the `inference` provider
(`packages/core/src/assembly/annotators/request-cache-key.ts:5-37`).

## 5. Does the response say which upstream served the request, and report cache usage?

Yes to both, but the SDK types only partially declare it.
- Routing metadata: `providerMetadata.gateway.routing` with `originalModelId`, `resolvedProvider`,
  `fallbacksAvailable`, `canonicalSlug`, `finalProvider`, `modelAttemptCount`, `modelAttempts[]`, and
  per attempt `provider`, `credentialType` (`'system'` | `'byok'`), `success`, `error`, `startTime`,
  `endTime`. Also `gateway.generationId`, `gateway.cost`, `gateway.marketCost`, and `gateway.routing.sort`
  when `sort` is set. — https://vercel.com/docs/ai-gateway/models-and-providers/provider-filtering-and-ordering
- Session metadata: `providerMetadata.gateway.routing.clientSessionId`,
  `clientSessionIdSource` (`'explicit' | 'agent' | 'fingerprint'`), `finalProvider`. "To check that a
  session stays on one provider, compare `finalProvider` across responses that share a
  `clientSessionId`." — https://vercel.com/docs/ai-gateway/models-and-providers/session-affinity
- Cache usage: `usage.inputTokenDetails.cacheReadTokens` in AI SDK 7 ("The AI SDK does not return a
  separate cache-hit boolean. A positive cache-read token count confirms that the provider read part
  of the prompt from cache. A zero count can mean a cache miss, an ineligible prompt, or unavailable
  provider usage details.") — https://vercel.com/docs/ai-gateway/models-and-providers/automatic-caching.
  Server-side, `getGenerationInfo(generationId)` returns `providerName`, `isByok`, `cachedTokens`,
  `cacheCreationTokens`, `latency` (`docs/00-ai-gateway.mdx` "Generation Lookup").
- Type caveat: `GatewayProviderMetadata` in 4.0.125 declares only `asyncJob` plus
  `readonly [key: string]: JSONValue | undefined` (`dist/index.d.ts:1440-1449`), so the routing fields
  are present but untyped: reading them needs a cast. `usage.inputTokenDetails.cacheReadTokens`
  belongs to the AI SDK usage type, not the Gateway package.

Logging `routing.finalProvider` + `routing.modelAttempts[].providerAttempts[].credentialType` +
`clientSessionIdSource` next to `cacheReadTokens` per call is enough to see a reroute or a
credential change against a cold cache read.

## 6. Does the Gateway support DeepSeek `cache_control` hints at all?

No, and DeepSeek documents that it ignores them.
- Gateway: DeepSeek is listed as **Implicit** caching with `caching: 'auto'` → "No change needed.
  Caching happens automatically." — https://vercel.com/docs/ai-gateway/models-and-providers/automatic-caching
- DeepSeek's own cache is entirely server-side and automatic: "The DeepSeek API Context Caching on
  Disk Technology is enabled by default for all users, allowing them to benefit without needing to
  modify their code." — https://api-docs.deepseek.com/guides/kv_cache/
- DeepSeek's Anthropic-compatible API lists `cache_control` on system, tool_use and tool_result blocks
  as **Ignored** — https://api-docs.deepseek.com/guides/anthropic_api
- Hit accounting for the raw API is `usage.prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`
  (same kv_cache page); on the Anthropic-compatible route, `input_tokens` excludes hits and
  `cache_read_input_tokens` reports them, `cache_creation_input_tokens` is always `0`.

So the only lever on DeepSeek is a byte-stable prompt prefix plus keeping the request on the account
that already wrote that prefix. Sending `caching: 'auto'` to a DeepSeek model changes nothing about
the prompt.

## What this implies for Atlas

1. **The plausible cause is credential-level rerouting under a fingerprint-only session.** Atlas sends
   no session id and no affinity header for gateway models (`apps/agent-host/src/model/providers/gateway-model.ts`
   sets only `gateway.caching`), so the Gateway identifies the session by fingerprint, and a
   fingerprint pin covers the provider but not the credential. DeepSeek is one provider slug, so
   provider promotion cannot constrain anything, and the account serving request N+1 can differ from
   the account that wrote request N's prefix, which is precisely the documented cold-cache case.
   The fix candidate is one documented option: a stable **`providerOptions.gateway.sessionId`**
   (or `x-session-id` / `x-session-affinity` header) per conversation/thread — "for session IDs you
   send … the pin also names the exact credential". Note it is not in the installed 4.0.125 types, so
   it needs a typed wrapper where `GatewayProviderOptions` is extended rather than `as any`.
2. **Second, cheaper suspect worth ruling out first: the fingerprint itself.** It is computed from the
   first system message, the first non-system message and the tool set. Anything volatile in the system
   prompt head or a tool set that changes between model calls inside one turn re-keys the session, and
   with it the pin. An explicit `sessionId` removes this failure mode as well, which is why it is the
   first thing to try.
3. **DeepSeek needs no caching options.** `caching: 'auto'` is documented as a no-op there, so the
   absence of caching options on that route is not the bug; `has: ['implicit-caching']` is available if
   we want routing to refuse providers that cannot cache implicitly.
4. **Anthropic's health is explainable and not evidence that routing is stable.** Manual
   `cacheControl` (with `ttl: '1h'`) is honoured, and the Gateway extends the pin to a 1-hour TTL from
   that same key. A single warm account plus 1h TTL hides credential variance that DeepSeek's 5-minute
   prefix behaviour exposes.
5. **We can measure this without new providers.** Log `providerMetadata.gateway.routing.finalProvider`,
   `routing.modelAttempts[*].providerAttempts[*].credentialType`,
   `routing.clientSessionIdSource` and `usage.inputTokenDetails.cacheReadTokens` per model call. A cold
   call that coincides with `clientSessionIdSource: 'fingerprint'` flipping, or with a credential
   change, settles the diagnosis.
6. **`caching: 'auto'` plus our own Anthropic breakpoints is not addressed by any doc.** We currently do
   both for gateway-hosted Anthropic models. The Gateway's auto markers are placed on the last message
   and the message before the last user message, and Anthropic rejects a fifth `cache_control`, so the
   combination deserves a look; observed cache reads are near-perfect, but that is short of proof that
   no request exceeded the budget.

## Unverified / could not confirm

- **Whether the Gateway rotates upstream provider accounts or regions per request for one model slug,
  and how often.** No page states rotation. What is documented is the weaker, sufficient claim that the
  cache belongs to the account and that a fingerprint-only session does not pin the account. The
  mechanism connecting our symptom to routing is inference from those two statements, not a quoted
  guarantee.
- **Whether DeepSeek's disk cache is scoped per API account/key.** DeepSeek's docs say the cache is
  enabled "for all users" and describe prefix-unit semantics, but never state the isolation boundary.
  Vercel's phrasing ("A provider's prompt cache lives on the provider account that served your
  request") is the only per-account statement found.
- **Whether `providerOptions.anthropic.cacheControl` requires anything else through the Gateway**
  (an `anthropic-beta` header for the 1-hour TTL, an explicit opt-in flag). The docs list it as the
  manual path and read `cacheControl.ttl` for pin lifetime; they do not enumerate prerequisites.
- **Whether `sessionId` / `sessionAffinity` are validated client-side in `@ai-sdk/gateway` 4.0.125.**
  They are absent from the types and the source; they appear to be passed via the open index signature
  and validated by the service.
- **Whether a cold call can be blamed on DeepSeek's own cache retention.** DeepSeek says caches are
  cleared "usually within a few hours to a few days" when unused, which cannot explain sub-second
  flapping inside one turn; that timing argument is ours, not theirs.
- **What the 12,288 / 65,536 cache-read values correspond to.** DeepSeek documents prefix units and
  "fixed token intervals" without publishing the interval, so the block-like sizes are consistent with
  unit granularity but not documented as such.
- **Whether `x-session-affinity`/`x-session-id` are forwarded to DeepSeek and used for its cache
  routing.** The Gateway says it forwards those headers "to the provider it selects, so providers that
  use them for their own cache routing can"; DeepSeek's docs do not mention them.

## Follow-up, 2026-11-10: the pin shipped, the routing never surfaced

Atlas now sends the thread id as `gateway.sessionId` and stops adding `caching: 'auto'` for
`anthropic/…` models (PR #2139). Two things were learned after it shipped, both from measurement
rather than docs.
- **The SDK never exposes routing, so nothing can record which account served a call.**
  `@ai-sdk/gateway` 4.0.125 (installed) and 4.0.139 (registry `latest`) both declare gateway
  metadata as `asyncJob` plus an index signature, and neither parses `finalProvider` or
  `clientSessionIdSource` from the response. The span fields added to read them were removed again:
  they could never populate, and upgrading the dependency would not change that.
- **Sending the session id produced no measurable change on DeepSeek.** After the release, 746
  calls on `1.294.0`/`1.295.0` were compared with 4,216 on older serves. Pooled, cold calls fell
  from ~5% to 1.3% and fresh tokens per call from 36.1k to 20.9k — but `1.293.0`, released before
  the change and never carrying it, measured the same (16.5k fresh tokens per call, 89.6% of fresh
  re-read, 1.0% cold). The gradient tracks how recently a sandbox started, not the session id, so
  no effect is attributable to affinity on this route. Plausible reasons: Baseten does not use
  `x-session-affinity` for cache routing (undocumented either way), or the write from one call is
  not visible to the next call a second later.
- **The dominant cost is not routing.** On every serve version tried, ~90% of the tokens billed as
  fresh input are re-reads of prompt the previous call in the same turn already sent — 17k to 50k
  tokens per call on a prompt that only grows. That survives both routing settings and is what the
  DeepSeek bill is actually made of.
