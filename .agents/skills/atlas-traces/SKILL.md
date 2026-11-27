---
name: atlas-traces
description: "Read Atlas's own agent-loop traces in PostHog (service `atlas-agent`): where a slow turn spent its time, slow model calls (time to first chunk/output), slow tools, retry backoff, and prompt-cache health from cacheReadTokens/cacheWriteTokens. Use when the operator says the loop feels slow, asks how long model calls or tools take, wants to check caching, or names a trace, turn, thread or session to investigate."
---

# Reading Atlas traces

Every Atlas turn sends one trace to PostHog, project 411591 ("Atlas"), with resource
`service.name` set to `atlas-agent`. v2 is the only loop. Its spans start 2026-11-20, so there is
no earlier v2 data. v1 and its `atlas` service are gone (last span 2026-11-23).

The spans are declared in `packages/observability/src/trace/trace.port.ts:4` (`ESpan`) and
`:68` (`SpanFields`). They are emitted from `packages/agent/src/trace/`,
`packages/agent/src/tools/dispatch.ts`, `packages/host/src/holder/` and
`apps/api/src/api/platform/sessions/prompt-post-span.ts`. If a span or field below is missing
from those files, the code wins: update this skill.

Query with the PostHog MCP server: run `exec` with `call execute-sql {"query": "..."}`. The table
is `posthog.trace_spans`. The useful columns are `trace_id`, `span_id`, `parent_span_id`,
`is_root_span`, `name`, `timestamp`, `end_time`, `duration_nano`, `status_code`, `service_name`,
`resource_attributes`, `attributes` and `events`. `attributes` is a Map: read
`attributes['key']`, and list the keys with `arrayJoin(mapKeys(attributes))`. Send one statement
per `exec` call. Always add a `LIMIT` and a time filter.

## The span tree

```
turn                            root, one fresh trace per turn
├ turn.hooks                    before-turn hooks
├ step.intake                   draining queued operator input and notices
├ loop.watch                    the loop-watch judge, only when it runs
├ context.prepare               assembling the step's context (threadId, step)
├ model.call                    one per attempt, retries included
│ └ model.resolve               the branch-model read (provider, model, phase)
├ model.backoff                 the retry wait between attempts (delayMs)
├ record.append                 event-log writes (drafts)
└ tool                         one per tool call; parallel calls overlap
  ├ tool.hooks                 before-tool hooks
  ├ tool.invoke                the tool itself (bash, read, grep, ...)
  ├ tool.after-hooks           after-tool hooks
  └ record.append              the tool result written back
```

A hook is its own span. It nests in `turn.hooks`, `tool.hooks`, `tool.after-hooks` or `turn`:

```
hook                            one per hook (hook, phase)
└ resource.wait               (waitFor, resource)
└ resource.status / resource.versions
└ resource.arm
└ resource.load               (resource, phase)
└ resource.append             (drafts)
```

The `resource.*` spans are plugin resources refreshing. They also appear under `tool.invoke` when
a tool triggers the refresh. `resource.wait` is the time a turn start was blocked: the initial
refresh, a background load of one resource, the load of the resource whose cloud setting changed,
or every attempt to settle. A wait the turn does not block on records no `resource.wait`: a reload
started in the background because the pod is not ready, a background resource such as mcp-tools, a
watch-change reload, an after-turn refresh. The span is recorded in the waiting context, so it
appears under the `turn` or `hook` that waited even when the refresh itself started before that
turn, outside any trace.

Two more root spans carry the same service:

```
prompt.post                     one per tRPC send, from apps/api
holder.takeover                 one per take-over of a session in the holder
holder.prepare                  one per workspace prepare attempt (sandbox wake to setup start)
```

A new session's first prompt waits for `holder.prepare`, so it dominates cold `queuedMs`.
`prepareMs` minus the step laps is work the steps do not cover (token, signing, secrets, Cloud
file mounts, `mise install`).

A sub-agent's turn is its own trace, not a child of the tool call that spawned it. Join them on
the `turn` span's `threadId`.

`model.call` carries no `threadId`. To reach a thread's calls, take the `trace_id` of its turns
first. `tool` carries `threadId` and `runId`, so it needs no join.

Ignore these names when rows show them. The code no longer emits them, but PostHog keeps rows
from older releases: `record.load`, `record.read`, `tool.quality`, `pod.boot`, `pod.boot.*`,
`pod.provision`, `pod.provision.*`, `prompt.send`. Check the current `ESpan` list before you add
one back.

## Fields

| Field | On | Meaning |
| --- | --- | --- |
| `threadId` | `turn`, `step.intake`, `context.prepare`, `record.append`, `tool` | Join key into the session's event log |
| `runId` | `turn`, `tool` | The run that wrote the events |
| `callId` | `tool` | The tool call id in the event log; the full command or input lives there, never in the span |
| `status` | `turn` | How the turn ended: `completed`, `failed`, `interrupted`, `idle`, `parked`, `relocation-paused` |
| `failureKind` | `turn`, failed `hook` | Failure class of a failed turn or a hook that hit its budget |
| `entry` | `turn` | `start` for a fresh turn, `resume` for a continued one |
| `wake` | `turn` | `cold` for the first turn on a thread in this pod process, `warm` for every later turn on that thread |
| `queuedMs` | `turn` | Pod wall time at turn start minus the post time of the operator prompt the turn answers. Absent when the turn answers no prompt (a notice or timer woke it) |
| `firstTokenMs` | `turn` | Turn start minus the same prompt post time, to the first streamed chunk of the turn's first `model.call` |
| `provider`, `model` | `turn`, `model.call`, `model.resolve` | Which model ran |
| `auth` | `model.call` | `oauth` or the API-key kind |
| `phase` | `model.resolve`, `resource.load`, `resource.status` | `kept`, `timed-out` or `read-failed` on a resolve; the refresh reason on a resource span |
| `waitFor` | `resource.wait` | What the blocked turn start waited for: `initial-refresh`, `background-load`, `changed-resource` or `settle`; `resource` names the resource for a background load or the changed setting |
| `first_chunk_ms` | `model.call` | Request to the first streamed chunk of any kind |
| `first_reasoning_ms` | `model.call` | Request to the first thinking chunk; absent when the model did not think |
| `first_output_ms` | `model.call` | Request to the first visible text or tool-call chunk |
| `inputTokens`, `outputTokens` | `model.call` | Token counts for the attempt |
| `cacheReadTokens`, `cacheWriteTokens` | `model.call` | Prompt cache read back and written by this attempt. Absent when the provider reports no write |
| `finishReason`, `toolCalls`, `speed` | `model.call` | Why the step stopped, how many tools it asked for, and `fast` or `standard` routing |
| `size.*` | `model.call` | Characters per part of the request (see below) |
| `hash.*` | `model.call` | A stable hash per part. Equal hashes mean identical text between two calls |
| `delayMs` | `model.backoff` | Planned retry delay |
| `tool`, `outcome` | `tool` | Tool name; `ok`, `error`, `denied` or `handoff` |
| `hook` | `hook` | Hook name |
| `drafts` | `record.append`, `step.intake`, `resource.append` | How many drafts were written or read |
| `sessionId`, `inboxId`, `hasMedia` | `prompt.post` | The session, the inbox row the post wrote, and whether the message carried an attachment |
| `clientToApiMs` | `prompt.post` | Client `sentAt` to API receipt, dropped when negative or over a minute (clock skew) |
| `claimMs`, `configMs`, `recordMs`, `<lap>Ms`, `firstStepMs` | `holder.takeover` | The take-over's own timings: the claim wait, building the runtime, loading the record, each lap (`branches`, `commands`, `decide`, `settle`), and the stretch to the first step |
| `sandboxMs`, `daemonMs`, `cloneMs`, `setupMs`, `stepsMs`, `seedMs`, `recordMs`, `setupEndMs`, `prepareMs` | `holder.prepare` | Each workspace step from its first start report to done, the holder phases after it, and the whole attempt; with `attempt`, `outcome`, `preparedBefore`, `promptWaiting` |
| `error.class` | any failed span | Error constructor name only; the message is never exported |
| `service.version` | resource | The Atlas release. Read it as `resource_attributes['service.version']` |

Durations are nanoseconds (`duration_nano`). The `*_ms` fields are milliseconds.

`first_output_ms` minus `first_chunk_ms` is thinking time. `duration_nano` minus
`first_output_ms` is streaming time. A call with a low `first_output_ms` and a huge
`duration_nano` is a long stream, not slow thinking.

The `size.*` keys split the request:

- `size.system.<source>` splits the system prompt by producer: `system-prompt`, `instructions`,
  `memory-index`, `skills-listing`, `deferred-tools`.
- `size.system.prompt.<section>` splits the main prompt section by section
  (`environment.today`, `safety.git-etiquette`, `tools.parallel-calls`, ...).
- `size.tools.builtin` and `size.tools.mcp.<server>` split the tool declarations; add `.count`
  for the number of tools.
- `size.messages` covers the whole thread. `size.messages.context.<source>` splits the envelope
  sources (`mcp-instructions`, `workspace`, `plan`, `uploads`, `skill` ...), and
  `size.messages.tool-results` is the tool output share.
- `size.total` is the sum.

## Recipes

Every query below ran against project 411591 on 2026-11-25.

**Where did a slow turn go?** List recent turns, slowest first:

```sql
SELECT trace_id, timestamp, resource_attributes['service.version'] AS version,
       attributes['threadId'] AS threadId, attributes['status'] AS status,
       attributes['wake'] AS wake, round(duration_nano/1e9, 1) AS seconds
FROM posthog.trace_spans
WHERE service_name = 'atlas-agent' AND name = 'turn' AND timestamp > now() - INTERVAL 24 HOUR
ORDER BY duration_nano DESC LIMIT 10
```

Open one trace and sort its spans by duration:

```sql
SELECT name, parent_span_id, attributes['tool'] AS tool, round(duration_nano/1e6, 0) AS ms
FROM posthog.trace_spans
WHERE service_name = 'atlas-agent' AND trace_id = 'jtPdVh8LAHxEzC/Ig7KNmg=='
ORDER BY duration_nano DESC LIMIT 15
```

PostHog has no self-time column, and a child's time counts inside its parent. A `turn` with a
large duration and small children is an untraced gap: add a span where that time goes. In the
example above the 3052 s turn is 240-295 s `bash` calls. Look at `tool` rows first; a large
`tool.invoke` is the command, and a large `tool` with a small `tool.invoke` is the hooks.

**A resumed turn waits on the handed-over tool first.** A `turn` with `entry=resume` and
`wake=cold` usually starts with a `tool` span for a call that was in flight when the old host let
go. The new host takes over the same daemon call (same `callId`, the command runs once) and waits
for it, so turn start to first `model.call` is the rest of that command, not overhead. The same
`callId` then has a `tool` span on each host, and the old one closes with outcome `handoff`. To
measure the resume itself, subtract the longest `tool` span that starts before the first
`model.call`. `queuedMs` and `firstTokenMs` on a resume count from the original prompt post, so
they include the earlier turn.

**Slow model calls.** Compare the p50 and p95 of both marks per model:

```sql
SELECT attributes['provider'] AS provider, attributes['model'] AS model, count() AS calls,
       round(quantile(0.5)(toFloat64OrNull(attributes['first_chunk_ms'])), 0) AS p50_first_chunk_ms,
       round(quantile(0.95)(toFloat64OrNull(attributes['first_chunk_ms'])), 0) AS p95_first_chunk_ms,
       round(quantile(0.5)(toFloat64OrNull(attributes['first_output_ms'])), 0) AS p50_first_output_ms,
       round(quantile(0.95)(toFloat64OrNull(attributes['first_output_ms'])), 0) AS p95_first_output_ms
FROM posthog.trace_spans
WHERE service_name = 'atlas-agent' AND name = 'model.call' AND timestamp > now() - INTERVAL 24 HOUR
GROUP BY provider, model ORDER BY calls DESC
```

A high `first_chunk_ms` is provider latency or a cold prompt cache (check the cache fields). A
large gap between first chunk and first output is the model thinking.

**Slow tools.** Group `tool` by name; `tool` carries the real name, so an MCP tool appears as
`mcp__server__tool` and a deferred tool needs no special case:

```sql
SELECT attributes['tool'] AS tool, count() AS calls,
       round(avg(duration_nano)/1e6, 0) AS avg_ms,
       round(quantile(0.95)(duration_nano)/1e6, 0) AS p95_ms,
       round(max(duration_nano)/1e6, 0) AS max_ms,
       countIf(attributes['outcome'] = 'error') AS errors
FROM posthog.trace_spans
WHERE service_name = 'atlas-agent' AND name = 'tool' AND timestamp > now() - INTERVAL 24 HOUR
GROUP BY tool ORDER BY avg_ms DESC LIMIT 15
```

To see what a slow call actually ran, find its `callId` in the session's event log.

**Retries.** Failed attempts carry `error.class`:

```sql
SELECT attributes['error.class'] AS error_class, attributes['provider'] AS provider,
       attributes['model'] AS model, count() AS failed_calls, max(timestamp) AS last_seen
FROM posthog.trace_spans
WHERE service_name = 'atlas-agent' AND name = 'model.call'
  AND attributes['error.class'] IS NOT NULL AND timestamp > now() - INTERVAL 7 DAY
GROUP BY error_class, provider, model ORDER BY failed_calls DESC LIMIT 20
```

Then look for `model.backoff` spans and for more than one `model.call` in the same trace:

```sql
SELECT trace_id, timestamp, attributes['delayMs'] AS delay_ms
FROM posthog.trace_spans
WHERE service_name = 'atlas-agent' AND name = 'model.backoff' AND timestamp > now() - INTERVAL 24 HOUR
ORDER BY timestamp DESC LIMIT 20
```

**What is the prompt made of?** Read the `size.*` and `hash.*` attributes of one call:

```sql
SELECT arrayJoin(mapKeys(attributes)) AS attr, attributes[attr] AS value
FROM posthog.trace_spans
WHERE service_name = 'atlas-agent' AND name = 'model.call'
  AND trace_id = (SELECT trace_id FROM posthog.trace_spans
                  WHERE service_name = 'atlas-agent' AND name = 'turn'
                    AND attributes['threadId'] = '6d51199d-31ac-4fb6-a2ad-e4738f26434f'
                  ORDER BY timestamp LIMIT 1)
LIMIT 200
```

Characters to tokens is roughly chars / 4. Calibrate against `inputTokens` on the same span; the
ratio holds best on English prose and drifts on JSON, code and system text. A part that is large
but keeps the same `hash.*` between steps is a caching candidate. A part whose size grows every
step is a budget problem.

**Prompt-cache health.** Order a thread's `model.call` spans by time. The join goes through the
thread's turns, because `model.call` has no `threadId`:

```sql
SELECT m.timestamp, m.attributes['inputTokens'] AS input,
       m.attributes['cacheReadTokens'] AS cache_read,
       m.attributes['cacheWriteTokens'] AS cache_write,
       m.attributes['size.total'] AS size_total
FROM posthog.trace_spans m
WHERE m.service_name = 'atlas-agent' AND m.name = 'model.call'
  AND m.timestamp > now() - INTERVAL 24 HOUR
  AND m.trace_id IN (SELECT trace_id FROM posthog.trace_spans
                     WHERE service_name = 'atlas-agent' AND name = 'turn'
                       AND attributes['threadId'] = '6d51199d-31ac-4fb6-a2ad-e4738f26434f')
ORDER BY m.timestamp LIMIT 40
```

- Healthy: reads grow every step to roughly the previous step's input, and writes stay near one
  step's new content (a few thousand tokens).
- Broken: reads sit at a fixed level for several steps while writes are tens of thousands. A
  cache breakpoint landed on text that changes every step.
- A read of 0 with a write of the whole input is a cold cache: the first step of a session, or a
  cache whose TTL lapsed.

**Find a trace by thread.** The `turn` span carries `threadId`:

```sql
SELECT timestamp, trace_id, attributes['status'] AS status, attributes['wake'] AS wake,
       round(duration_nano/1e9, 1) AS seconds
FROM posthog.trace_spans
WHERE service_name = 'atlas-agent' AND name = 'turn'
  AND attributes['threadId'] = '6d51199d-31ac-4fb6-a2ad-e4738f26434f'
ORDER BY timestamp DESC LIMIT 10
```

`prompt.post` carries `sessionId`, not `threadId`. To go from a session to its threads, read the
session's event log; a session can own several threads.

**Compare releases.** Group on the resource attribute:

```sql
SELECT resource_attributes['service.version'] AS version, max(timestamp) AS last_seen,
       count() AS spans
FROM posthog.trace_spans
WHERE service_name = 'atlas-agent' AND timestamp > now() - INTERVAL 1 DAY
GROUP BY version ORDER BY last_seen DESC
```

## Ground rules

- Spans carry names, ids and counts only. Never try to add prompt text, paths or commands to a
  span; follow `callId` or `threadId` into the event log instead.
- Telemetry is off under tests and with `ATLAS_TELEMETRY=0`, so a session can legitimately send
  no traces.
- One trace is an anecdote. Before calling something a regression, check it across several turns
  and sessions.
