---
name: atlas-traces
description: "Read Atlas's own agent-loop traces in PostHog (service `atlas-agent` for v2, `atlas` for v1): where a slow turn spent its time, slow model calls (time to first chunk/output), slow tools, retry backoff, and prompt-cache health from cacheReadTokens/cacheWriteTokens. Use when the operator says the loop feels slow, asks how long model calls or tools take, wants to check caching, or names a trace, turn, thread or session to investigate."
---

# Reading Atlas traces

Every Atlas turn sends one trace to PostHog distributed tracing (project "Atlas"). The resource
`service_name` says which loop ran it: `atlas-agent` is the v2 loop (pod, control plane, every
session since #2475), and `atlas` is the v1 loop (the released serve and TUI, and anything still on
it). Filter on both unless you know which one you need: `serviceNames: ["atlas-agent", "atlas"]`.

The spans are defined in `packages/observability/src/trace/trace.port.ts` (`ESpan`, `SpanFields`)
and emitted from `packages/agent/src/trace/` and `packages/agent/src/tools/dispatch.ts`. If a span
or field below is missing from that file, the file wins: update this skill.

Use PostHog's MCP tracing tools (`apm-services-list`, `query-apm-spans`, `apm-trace-get`,
`apm-spans-aggregate`). Load `posthog:exploring-apm-traces` for their general mechanics; this skill
covers what Atlas's spans mean.

## The span tree

```
turn                        root, one fresh trace per turn
├ turn.hooks                before-turn hooks
├ record.read / record.append   event-log reads and writes (anywhere in the tree)
├ step.intake               draining queued operator input and notices
├ loop.watch                the loop-watch judge
├ context.prepare           assembling the step's context
├ model.call                one per attempt, retries included
├ model.backoff             retry wait between attempts
└ tool                      one per tool call; parallel calls overlap
  ├ tool.hooks              before-tool hooks (permissions, guards)
  ├ tool.invoke             the tool itself (bash, read, grep, ...)
  ├ tool.quality            quality review
  └ tool.after-hooks        after-tool hooks
```

A sub-agent's turn is its own trace, not a child of the tool call that spawned it. Join them on
`threadId`.

A cloud pod boots under its own trace (service `atlas-agent`), one per serve process:

```
pod.boot                    root, one fresh trace per serve process
├ pod.boot.clone            fetching the workspace spec and materializing the repo
├ pod.boot.settings         cloud state, settings and file mounts
├ pod.boot.hydrate          reading the session's event log back
└ pod.boot.compose          composing the harness: tools, hooks, plugins, mcp
```

`sandbox-setup` and the mcp connect happen inside `pod.boot.compose`; a long boot is the phase
with the large self time, not the root.

What the API sends ahead of the pod is its own trace (service `atlas-agent`, from apps/api):

```
prompt.send                 root, one per tRPC threadMessages.send
```

The pod is provisioned before it boots (apps/api, service `atlas-agent`). The `pod-provision`
Trigger.dev task opens the trace and shuts the tracer down before the task process exits:

```
pod.provision               root, one per pod-provision run
├ pod.provision.sandbox     mounting the sandbox: a fresh create or a resume from its snapshot
└ pod.provision.agent       preparing the workspace, launching serve, waiting for its url to route
```

`pod.provision` covers the whole wait from the claimed prompt to a running pod, so a run whose
claim was superseded shows a root with no children. The stretch from `pod.provision.agent` ending
to the first `pod.boot` span is serve starting up.

## Fields

| Field | On | Meaning |
| --- | --- | --- |
| `threadId`, `runId` | `turn`, `tool`, record spans, `pod.boot*`, `pod.provision*`, `prompt.send` | Join keys into the session's event log |
| `callId` | `tool` | The tool call id in the event log; the full command or input lives there, never in the span |
| `status` | `turn` | How the turn ended (`completed`, `failed`, `interrupted`, ...) |
| `queuedMs` | `turn` | Pod wall time at turn start minus the `at` of the operator prompt the turn answers — the server-stored prompt → turn start stretch. Absent when the turn was not started by a prompt (a notice or timer woke it) and on a resume |
| `wake` | `turn` | `cold` for the first turn on a thread in this pod process (the thread's first turn after a serve boot), `warm` for every later turn on that thread |
| `provider`, `model` | `turn`, `model.call` | Which model ran |
| `first_chunk_ms` | `model.call` | Time from request to the first streamed chunk of any kind |
| `first_reasoning_ms` | `model.call` | Time to the first thinking chunk; absent when the model did not think |
| `first_output_ms` | `model.call` | Time to the first visible text or tool-call chunk |
| `inputTokens`, `outputTokens` | `model.call` | Token counts for the attempt |
| `cacheReadTokens`, `cacheWriteTokens` | `model.call` | Prompt cache read back and written by this attempt |
| `finishReason`, `toolCalls` | `model.call` | Why the step stopped and how many tools it asked for |
| `size.*` | `model.call` | Characters per part of the request: `size.system.<source>`, `size.tools.builtin`, `size.tools.mcp.<server>`, their `.count`, `size.messages`, `size.messages.context.<source>`, `size.total` |
| `delayMs` | `model.backoff` | Planned retry delay |
| `tool`, `outcome` | `tool` | Tool name; `ok`, `error` or `denied`. |
| `drafts`, `events` | record and intake spans | How many events were written or read |
| `verdict` | `loop.watch` | The judge's verdict |
| `error.class` | any failed span | Error type only; the message is never exported |
| `service.version` | resource | The Atlas release. `dev` for local builds, and for every cloud serve released before #1790 |

Durations in tool responses are nanoseconds (`duration_nano`). A `duration` filter in
`query-apm-spans` is milliseconds.

`first_output_ms` minus `first_chunk_ms` is thinking time. `duration_nano` minus `first_output_ms`
is streaming time.

## Recipes

Always set `dateRange`, filter `serviceNames: ["atlas-agent", "atlas"]` unless the operator named an
older session, and surface the `_posthogUrl` that `apm-trace-get` returns so the operator can open
the trace.

**Where did a slow turn go?** List recent turns, slowest first, then open one:

```json
{"query": {"serviceNames": ["atlas-agent", "atlas"], "dateRange": {"date_from": "-6h"}, "rootSpans": true,
  "orderBy": "duration", "limit": 10, "excludeAttributes": true}}
```

Pass the `trace_id` to `apm-trace-get`. Sort its spans by `self_time_nano`: a `model.call` or
`tool.invoke` with large self time is the cost. A `turn` with large self time is an untraced gap.
Add a span where that time goes.

**Slow model calls.** Query `model.call` as flat spans and compare `first_chunk_ms` and
`first_output_ms`:

```json
{"query": {"serviceNames": ["atlas-agent", "atlas"], "dateRange": {"date_from": "-1d"}, "flatSpans": true,
  "rootSpans": false, "orderBy": "duration",
  "filterGroup": [{"key": "name", "type": "span", "operator": "exact", "value": "model.call"}]}}
```

High `first_chunk_ms` is provider latency or a cold prompt cache (check the cache fields). A large
gap between first chunk and first output is the model thinking.

**Slow tools.** The same query with `"value": "tool"`, then break down by the `tool` attribute
(`apm-attribute-breakdown`) or aggregate per operation (`apm-spans-aggregate`). A tool that is
deferred in the prompt is called by its real name, so a breakdown needs no special case for
deferred tools. To see what a slow call actually ran, find its `callId` in the session's event log.

**Retries.** Look for `model.backoff` spans and more than one `model.call` per step. Failed attempts
carry `error.class`.

**What is the prompt made of?** Query `model.call` as flat spans, filtered to one `threadId`, and
take the thread's first step (a fresh session's first call is where the fixed prefix dominates).
Read the `size.*` attributes: `size.system.<source>` splits the system prompt by producer
(`system-prompt`, `instructions`, `memory-index`, `skills-listing`, `repo-agents`),
`size.tools.builtin` and `size.tools.mcp.<server>` split the tool declarations, and `size.messages`
covers the thread including `size.messages.context.<source>` envelopes such as
`mcp-instructions`. `size.total` is the sum.

```json
{"query": {"serviceNames": ["atlas-agent", "atlas"], "dateRange": {"date_from": "-1d"}, "flatSpans": true,
  "rootSpans": false, "filterGroup": [
    {"key": "name", "type": "span", "operator": "exact", "value": "model.call"},
    {"key": "threadId", "type": "span", "operator": "exact", "value": "<thread id>"}]}}
```

Characters to tokens is roughly chars / 4; calibrate against `inputTokens` on the same span (the
ratio holds best on English prose and drifts on JSON, code and system text). A part that is large
but rarely changes is a caching candidate; one that grows every step is a budget problem.

**Prompt-cache health.** Order a session's `model.call` spans by timestamp (filter on `threadId`
via its turns) and read `cacheReadTokens` and `cacheWriteTokens` step by step.

- Healthy: reads grow every step to roughly the previous step's input, and writes stay near one
  step's new content (a few thousand tokens).
- Broken: reads sit at a fixed level for several steps while writes are tens of thousands. On
  2026-11-03 that pattern was a cache breakpoint landing on a per-step reminder (fixed in #1797,
  `packages/core/src/assembly/annotators/cache-breakpoints.ts`).
- A read of 0 with a write of the whole input is a cold cache: the first step of a session, or
  after the cache TTL lapsed.

**Compare releases.** Filter or break down on the `service.version` resource attribute
(`span_resource_attribute`). Spans from before #1790 all report `dev`.

## Ground rules

- Spans carry names, ids and counts only. Never try to add prompt text, paths or commands to a
  span; follow `callId` or `threadId` into the event log instead.
- Telemetry is off under tests and with `ATLAS_TELEMETRY=0`, so a session can legitimately send no
  traces.
- One trace is an anecdote. Before calling something a regression, check it across several turns
  and sessions.
