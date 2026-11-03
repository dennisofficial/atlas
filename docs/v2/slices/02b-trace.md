# Slice 2b spec: tracing the loop

Status: **approved 2026-11-03 by the operator in conversation, built in the PR that adds this
file.** Sibling to [roadmap.md](../roadmap.md); the package is fixed by
[0023](../../decisions/0023-observability-package.md).

## Goal

Answer "where did this slow turn spend its time" from data: model time to first chunk and first
output, streaming, retry backoff, tool hooks, tool execution, quality review, intake, the loop
watch, context preparation and record reads and appends. Every session sends its spans to
PostHog's distributed tracing, so the questions can be asked later across sessions.

## Decisions (operator, 2026-11-03)

- **Export to PostHog only.** Cloud sandbox disks are discarded, so a local file would lose the
  daily-driver data. Spans ride the same `posthog-node` client, project key, anonymous install id
  and `ATLAS_TELEMETRY` opt-out as product telemetry.
- **Implicit parenting.** The active span follows the async call chain (PostHog's own
  `AsyncLocalStorage` context in `/node`, an `AsyncLocalStorage` in `/testing`). Call sites never
  thread a parent through arguments.
- **Names, ids and counts only.** `SpanFields` is a closed object type, so a command, path,
  prompt or error message cannot be attached. A thrown error records only its class. `threadId`,
  `runId` and `callId` join a span to the event log, where the full content stays.

## Design

`@dltech/atlas-observability`:

| Where      | What                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| `.`        | `TracePort.span({ name, fields, run })`, `ESpan`, `ESpanMark`, `SpanFields`, `NullTracer`, `Observability` |
| `/node`    | `PosthogTracer` over `client.withSpan`; `observabilityFor` builds telemetry and tracer on one client       |
| `/testing` | `RecordingTracer`: in-memory span tree for specs                                                           |

`TracePort` registers in the port registry with an empty transport slot. `TracePort` has no flush:
the telemetry port's `flush` shuts the shared client down, which drains ended spans.

`@dltech/atlas-agent` adds `trace?: TracePort` to `TurnDeps`. When it is set, the
`LoopTurnRunner` constructor decorates its collaborators (`src/trace/`), so the loop body barely
changes:

| Span               | Source                                                                                       | Fields                                                 |
| ------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `turn`             | `LoopTurnRunner.runTurn`                                                                     | threadId, runId, provider, model, status               |
| `turn.hooks`       | before-turn hooks in `runTrackedTurn`                                                        |                                                        |
| `context.prepare`  | `prepareStepAssembly`                                                                        | threadId, step                                         |
| `model.call`       | `TracedModel.step` (one per attempt); marks `first-chunk`, `first-reasoning`, `first-output` | provider, model, finishReason, toolCalls, token counts |
| `model.backoff`    | the retry policy's `sleep`                                                                   | delayMs                                                |
| `step.intake`      | `AgentIntake.prepare`                                                                        | threadId, drafts                                       |
| `loop.watch`       | the `LoopWatch` judge                                                                        | outcome (verdict)                                      |
| `record.append`    | `AgentRecordPort.append`                                                                     | threadId, drafts                                       |
| `record.read`      | `composedEvents` / `ownEvents`                                                               | threadId, events                                       |
| `tool`             | `HookedToolDispatcher.dispatch` (takes `trace` in its constructor)                           | threadId, runId, callId, tool, outcome                 |
| `tool.hooks`       | before-tool hooks                                                                            |                                                        |
| `tool.invoke`      | the tool itself                                                                              |                                                        |
| `tool.quality`     | quality review                                                                               |                                                        |
| `tool.after-hooks` | after-tool hooks                                                                             |                                                        |

Harness wiring: `create-harness-container.ts` registers one `Observability` (PostHog when
telemetry is enabled, null otherwise) and resolves `TelemetryPort` and `TracePort` from it;
`turn-wiring.ts` passes `trace` into `TurnDeps`; both `HookedToolDispatcher` constructions
(container and child runner) receive it. Sub-agent turns inherit the active span of the tool call
that spawned them, so a child's turn nests under its spawn.

Slice 3 adds agent-host spans (daemon calls, CP appends, lease renewals) on the same port.

## Validation

- `packages/observability`: `RecordingTracer` nests concurrent spans correctly; `PosthogTracer`,
  driven through a real `PostHog` client with a capturing `fetch`, exports nested OTLP spans with
  marks and an error class but never an error message.
- `packages/agent`: a scripted turn with one tool call produces `turn` ⊃ `model.call`, `tool` ⊃
  `tool.invoke`, `record.append`; `TracedModel` marks first chunk and first output once each.
- `bunx turbo run typecheck`; changed specs in `harness`, `tui`, `serve`.
