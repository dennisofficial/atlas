export const DRAIN_APPEND_GRACE_MS = 10_000
export const DEFAULT_APPEND_RETRY_MS = 30_000

export const appendRetryDeadline = (params: {
  failingSince: number
  appendRetryMs: number | undefined
  drainDeadline: number | undefined
}): number => {
  const own = params.failingSince + (params.appendRetryMs ?? DEFAULT_APPEND_RETRY_MS)
  if (params.drainDeadline === undefined) return own
  return Math.min(own, params.drainDeadline + DRAIN_APPEND_GRACE_MS)
}
