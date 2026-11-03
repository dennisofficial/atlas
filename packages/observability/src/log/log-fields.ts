import type { LogEntry } from './log.port'

export function logFieldsOf({ error }: { error: unknown }): Pick<LogEntry, 'error' | 'stack'> {
  if (!(error instanceof Error)) return { error: String(error) }
  const cause = error.cause instanceof Error ? ` — cause: ${error.cause.message}` : ''
  if (error.stack === undefined) return { error: `${error.message}${cause}` }
  return { error: `${error.message}${cause}`, stack: error.stack }
}
