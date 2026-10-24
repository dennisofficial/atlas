import { ELogSeverity, type LogEntry, type LogPort, type ThreadId } from '@dltech/atlas-core'

export const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500

export const retryAfterMs = (response: Response): number | undefined => {
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter === null) return undefined
  const seconds = Number.parseFloat(retryAfter)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined
}

/**
 * The retry path reports through these so a throttled read is visible in the durable log before it
 * (maybe) becomes a CloudError — the bearer token is a constructor field and never enters a line.
 */
export type TransportRetryLog = { port: LogPort; threadId?: ThreadId | undefined }

export const noteRetry = (args: {
  log: TransportRetryLog | undefined
  method: string
  path: string
  cause: string
  attempt: number
  delayMs: number
}): void => {
  const entry: LogEntry = {
    severity: ELogSeverity.Warn,
    source: 'cloud.transport',
    message: `${args.method} ${args.path} failed (${args.cause}) — retrying in ${Math.round(args.delayMs)}ms`,
    threadId: args.log?.threadId,
    data: {
      method: args.method,
      path: args.path,
      cause: args.cause,
      attempt: args.attempt,
      delayMs: Math.round(args.delayMs),
    },
  }
  args.log?.port.record(entry)
}

export const noteGiveUp = (args: {
  log: TransportRetryLog | undefined
  method: string
  path: string
  cause: string
  attempt: number
}): void => {
  const entry: LogEntry = {
    severity: ELogSeverity.Error,
    source: 'cloud.transport',
    message: `${args.method} ${args.path} failed (${args.cause}) — giving up after ${args.attempt + 1} attempts`,
    threadId: args.log?.threadId,
    data: { method: args.method, path: args.path, cause: args.cause, attempt: args.attempt },
  }
  args.log?.port.record(entry)
}

export const backoffDelayMs = (args: {
  attempt: number
  baseDelayMs: number
  ceilingDelayMs: number
  randomFn: () => number
}): number => {
  const exponential = Math.min(args.ceilingDelayMs, args.baseDelayMs * 2 ** args.attempt)
  return exponential * args.randomFn()
}
