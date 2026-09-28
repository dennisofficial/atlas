import { toThreadId, type LogPort } from '@dltech/atlas-core'
import { JsonlLog, SystemClock, atlasDirectory, logFieldsOf, registryFor } from '@dltech/atlas-harness'

import { EServeEnv } from './serve-config'

/**
 * A serve that fails before its session exists has no container to resolve a LogPort out of, so
 * the writer is built from scratch. A home that cannot resolve must not cost the process its exit.
 */
export function serveOpLog(): JsonlLog | null {
  try {
    const home = atlasDirectory()
    return new JsonlLog({ home, registry: registryFor({ home }), clock: new SystemClock() })
  } catch {
    return null
  }
}

export function serveFatalEntry(args: {
  error: unknown
  env: Record<string, string | undefined>
}): Parameters<LogPort['error']>[0] {
  const threadId = args.env[EServeEnv.ThreadId]
  return {
    source: 'serve.boot',
    message: 'atlas serve could not start',
    ...logFieldsOf({ error: args.error }),
    data: { cwd: process.cwd(), threadId: threadId === undefined ? null : toThreadId(threadId) },
  }
}

export function logServeFatal(args: {
  log: LogPort | null
  error: unknown
  env: Record<string, string | undefined>
}): void {
  args.log?.error(serveFatalEntry({ error: args.error, env: args.env }))
}
