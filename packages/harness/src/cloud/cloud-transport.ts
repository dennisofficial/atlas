import type { TransportRetryLog } from './cloud-retry'

export type { TransportRetryLog }

export class CloudError extends Error {
  readonly status: number
  readonly code?: string

  constructor(args: { status: number; message: string; code?: string | undefined }) {
    super(args.message)
    this.name = 'CloudError'
    this.status = args.status
    if (args.code !== undefined) this.code = args.code
  }
}

export const isCloudUnavailable = (error: unknown): boolean =>
  error instanceof CloudError && (error.status === 0 || error.status >= 500)

/**
 * A refusal is the API answering, not failing: the session token itself was rejected, so cached
 * data behind it is forfeit and the operator has to sign back in. 401/402/403 only — a 404 is a
 * missing resource, not a dead session.
 */
export const isCloudRefusal = (error: unknown): boolean =>
  error instanceof CloudError && [401, 402, 403].includes(error.status)

/**
 * A 429 or a reset mid-turn must never be fatal: these are the injectable defaults behind the
 * opt-in `retry` flag, sized so a throttled read settles well inside a client's own reconnect
 * window rather than compounding it.
 */
export const DEFAULT_RETRY_MAX_ATTEMPTS = 4
export const DEFAULT_RETRY_BASE_DELAY_MS = 500
export const DEFAULT_RETRY_CEILING_DELAY_MS = 8_000
/**
 * A wedged control plane holds a connection open with no bytes until a proxy gives up at ~60s;
 * that hang must never be what a boot or a turn waits on. Every attempt gets its own abort so a
 * stall fails fast and the retry path (or the caller) takes over instead of blocking on the proxy.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
