export const DEFAULT_APPEND_RETRY_MS = 30_000

export const appendRetryDeadline = (params: {
  failingSince: number
  appendRetryMs: number | undefined
}): number => params.failingSince + (params.appendRetryMs ?? DEFAULT_APPEND_RETRY_MS)
