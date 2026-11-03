# 0023. Telemetry, operational logs and tracing live in `packages/observability`

Proposed 2026-11-03; accepted when the operator merges the PR that adds it. Adds a foundation
package to the map in [0019](0019-v2-package-map.md).

## Context

Atlas records what happened outside the conversation in three places, none of them in one home:
- Product telemetry: `TelemetryPort` and the telemetry policy sat in `core`, the PostHog adapter,
  the distinct-id file and the reason/feature classifiers in `harness/src/telemetry`.
- The operational log: `LogPort` sat in `core`, `logFieldsOf` in `agent`, `JsonlLog` in
  `harness/src/store`.
- Timing: only `turnCompleted.durationMs` and a few ad hoc `durationMs` log fields. Nothing says
  where a slow turn spent its time (model first token, streaming, retries, tools, hooks, appends).

v2 wants per-step tracing that every tier emits (`agent`, `pod`, `control`), while its exporters
carry I/O and vendor SDKs that none of those packages should depend on. `core` is zod-only, so
the exporters cannot live there.

## Decision

**`packages/observability` (`@dltech/atlas-observability`) owns everything Atlas records about
itself that is not the conversation record.**

| Subpath | Holds                                                                                                        | May import        |
| ------- | ------------------------------------------------------------------------------------------------------------ | ----------------- |
| `.`     | `TelemetryPort`, `LogPort`, `logFieldsOf`, the telemetry policy, `NullTelemetry`, the reason/feature classes | `core` only       |
| `/node` | `PosthogTelemetry` and the telemetry distinct-id file                                                        | `node:*`, vendors |

The package registers `TelemetryPort` and `LogPort` in the port registry by declaration merging,
as `harness` does for its own ports.

Tracing joins as a `TracePort` and span vocabulary on `.`, exporters on `/node`, when its slice is
specified. Spans never go into the conversation event log.

Staying put for now: `JsonlLog` (it writes through the session registry in `harness/src/store`)
and `ObservingToolDispatcher` (it extends the dispatcher, now in `harness/src/tools`).

## Why

- One home for "what Atlas did and how long it took", so tracing lands next to the telemetry and
  logs it complements instead of in a fourth place.
- The subpath edge keeps PostHog and future exporters out of `agent`, `pod` and `control`; the
  compiler enforces it rather than convention.

## Consequences

- `core` no longer exports telemetry or log symbols; importers use `@dltech/atlas-observability`.
- `posthog-node` moves from `harness` to this package.
- Pure: no v1 behaviour changes.
