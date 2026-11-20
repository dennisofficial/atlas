import type { ThreadId } from '@dltech/atlas-core'
import type { ESpan, TracePort } from '@dltech/atlas-observability'
import { serverObservability, telemetryDistinctId } from '@dltech/atlas-observability/node'

import { serveClientVersionOf } from './serve-version'

export const serveTracer = (args: { atlasHome: string }): TracePort =>
  serverObservability({
    version: serveClientVersionOf({ requested: undefined }),
    env: process.env,
  }).traceFor(telemetryDistinctId({ atlasHome: args.atlasHome, env: process.env }))

export const bootPhase = <T>(args: {
  trace: TracePort
  threadId: ThreadId
  name: ESpan
  run: () => Promise<T>
}): Promise<T> =>
  args.trace.span({
    name: args.name,
    fields: { threadId: args.threadId },
    run: () => args.run(),
  })
