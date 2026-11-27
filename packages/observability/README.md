# @dltech/atlas-observability

The ports for what Atlas records about itself: product telemetry, the operational log and timing
spans. The core tiers depend on the ports. Only the node tier imports a vendor SDK.

## Owns

- `TelemetryPort`: the typed product events, with enum-like fields and counts only.
- `TracePort`: the span contract, the `ESpan` names, the marks and the attribute mapping.
- `LogPort`: the operational log entry and the severity levels.
- `ProductAnalytics`: `capture({ userId, event, properties? })` sends one product event, and
  `flush()` sends the batch at shutdown. `capture` never throws and never waits on the network.
  `ProductAnalyticsProperties` types the `properties`.
- `ErrorReporter`: `report({ error, properties })` sends one server error to PostHog error
  tracking.
- The telemetry policy, and the classifiers that turn a tool name or a reason into a class.
- The PostHog exporters in the node tier, and `RecordingTracer` for specs.

## Does not own

- The hooks that emit a span, and the code that calls the ports. `@dltech/atlas-agent`,
  `@dltech/atlas-control` and the apps own it.
- The record of a thread. The thread record is the event log, not telemetry.
- The registry type. `@dltech/atlas-core` defines `PortRegistryEntries`; importing this package
  adds its three ports to it.

## Entry points

| Import                                | Use it for                                                           |
| ------------------------------------- | -------------------------------------------------------------------- |
| `@dltech/atlas-observability`         | The ports, the null implementations, the policy and the classifiers. |
| `@dltech/atlas-observability/node`    | The PostHog telemetry, tracer and analytics, and the distinct id.    |
| `@dltech/atlas-observability/testing` | `RecordingTracer`, which records the spans of a spec.                |

## Capabilities

### Record a product event

- `TelemetryPort`: `turnCompleted`, `featureUsed`, `toolDenied`, `agentSpawned`, `agentEnded`,
  `exception` and `flush`. `TelemetryTurn` and `TelemetryAgentRun` are the two event shapes.
- `NullTelemetry`: a `TelemetryPort` that does nothing.
- `NullProductAnalytics`: a `ProductAnalytics` that does nothing.
- `telemetryEnabled(env)`: says if telemetry runs. It reads `ATLAS_TELEMETRY` and the test-runner
  signal.
- `featureForTool(name)`, `reasonClassOf(reason)`: give the `feature` of a counted tool, or the
  `reasonClass` of a denial. `featureForTool` returns `undefined` for every other tool.

### Time a unit of work

- `TracePort.span({ name, fields, root, run })`: runs `run` inside a span. The active span follows
  the async call chain, so a nested call nests its span.
- Set `root: true` for the first span of a new trace. A non-root span outside an active trace runs
  the callback with `NULL_SPAN_HANDLE` and records nothing.
- `spanWith(trace, request)`: runs a span when a tracer exists, and runs the work alone when it does
  not. `NULL_SPAN_HANDLE`, `NullTracer`: the empty implementation.
- `ESpan`, `EResourceWait`, `ESpanMark`, `ESpanOutcome`, `ETurnEntry`, `EWake`, `ESpanSpeed`,
  `EFirstAction`, `ESandboxStart`, `EPrepareOutcome`, `EPreparePhase`, `SpanFields`,
  `SpanHandle`: the span vocabulary.
- `spanAttributesOf(fields)`, `markAttributeOf(mark)`, `errorClassOf(error)`: the attribute helpers.

```ts
await trace.span({ name: ESpan.Turn, root: true, run: () => turn() })
```

### Write an operational log entry

- `LogPort`: `record(entry)`, plus `info`, `warn` and `error`. It is fire-and-forget, and it
  swallows its own I/O error.
- `ELogSeverity`, `LogEntry`: the entry shape. The `source` is a dot-scoped name.
- `logFieldsOf({ error })`: gives the `error` and `stack` fields of a caught error.

### Report a server error

- `ErrorReporter`: `report({ error, properties })` sends one error to server error tracking. The
  `properties` are string, number or boolean values. `ErrorReportProperties` is the type.
- `NullErrorReporter`: an `ErrorReporter` that does nothing.
- `PosthogErrorReporter({ client })`: the PostHog implementation. It calls `captureException`
  under the fixed `atlas-server` distinct id, so the daily telemetry routine finds it among
  `$exception` events. It never throws.

### Use a real exporter

- `serverObservability(args)`, `ServerObservability`, `PosthogTracer`, `PosthogProductAnalytics`,
  `PosthogTelemetry`. `serverObservability` returns `analytics`, `errors` and `traceFor` over one
  PostHog client.
- `telemetryDistinctId(args)`, `persistedTelemetryDistinctId({ atlasHome })`: the stable id, kept in
  `telemetry.json`.
- `Observability`, `nullObservability()`: the pair of ports.

## Usage

From `apps/tui/src/main.tsx`:

```ts
import { logFieldsOf } from '@dltech/atlas-observability'

import { durableOpLog } from './boot/durable-op-log'

const report = (error: unknown): void => {
  durableOpLog()?.error({
    source: 'tui.boot',
    message: 'atlas could not start',
    ...logFieldsOf({ error }),
    data: { cwd: process.cwd() },
  })
}
```

A package that takes a `LogPort` calls `record`, `info`, `warn` or `error` and adds
`logFieldsOf({ error })` to the entry.

## Rules

- Import `@dltech/atlas-observability` in `core`-tier code. Do not import `/node` there. It loads
  `posthog-node` and `node:*`.
- Put no prompt text, file path, command line or report text in a span or a telemetry event. The
  ports carry names, ids and counts only.
- Use `spanWith` in a package that may run without a tracer.

## See also

- `docs/decisions/0023-observability-package.md` gives the tier split and its reason.
