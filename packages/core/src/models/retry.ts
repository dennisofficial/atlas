import {
  EProviderFailureKind,
  EProviderRetry,
  type NormalizedProviderFailure,
} from './provider-failure'

export enum ERetryReason {
  RateLimited = 'rate-limited',
  Overloaded = 'overloaded',
  ServerError = 'server-error',
  Network = 'network',
}

export type RetryPolicy = {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  maxRetryAfterMs?: number | undefined
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 10_000,
  maxRetryAfterMs: 60_000,
}

export type RetryDecision =
  | { retry: true; delayMs: number; reason: ERetryReason }
  | { retry: false }

const NOTHING_LEFT_TO_TRY: RetryDecision = { retry: false }

const OVERLOADED_STATUS = 529

function overloadedReasonOf(statusCode: number | undefined): ERetryReason {
  return statusCode === undefined || statusCode === OVERLOADED_STATUS
    ? ERetryReason.Overloaded
    : ERetryReason.ServerError
}

export function retryReasonOf(failure: NormalizedProviderFailure): ERetryReason | null {
  if (failure.retry === EProviderRetry.Never) return null
  switch (failure.kind) {
    case EProviderFailureKind.RateLimited:
      return ERetryReason.RateLimited
    case EProviderFailureKind.Overloaded:
      return overloadedReasonOf(failure.statusCode)
    case EProviderFailureKind.Network:
    case EProviderFailureKind.Stalled:
      return ERetryReason.Network
    default:
      return ERetryReason.ServerError
  }
}

function backoffMs(args: { attempts: number; policy: RetryPolicy; jitter: number }): number {
  const exponential = args.policy.baseDelayMs * 2 ** (args.attempts - 1)
  const capped = Math.min(exponential, args.policy.maxDelayMs)
  const spread = capped / 2
  return Math.round(spread + spread * args.jitter)
}

function waitUntilMs(args: { retryAt: string | undefined; nowMs: number }): number {
  if (args.retryAt === undefined) return 0
  const notBefore = Date.parse(args.retryAt)
  return Number.isFinite(notBefore) ? Math.max(0, Math.ceil(notBefore - args.nowMs)) : 0
}

export function planRetry(args: {
  failure: NormalizedProviderFailure
  attempts: number
  policy: RetryPolicy
  jitter: number
  nowMs: number
}): RetryDecision {
  const reason = retryReasonOf(args.failure)
  if (reason === null) return NOTHING_LEFT_TO_TRY
  if (args.attempts >= args.policy.maxAttempts) return NOTHING_LEFT_TO_TRY

  const waitMs = waitUntilMs({
    retryAt: args.failure.retryAt,
    nowMs: args.nowMs,
  })
  const longestWaitMs = args.policy.maxRetryAfterMs ?? args.policy.maxDelayMs
  if (waitMs > longestWaitMs) return NOTHING_LEFT_TO_TRY

  const delayMs = Math.max(
    backoffMs({
      attempts: args.attempts,
      policy: args.policy,
      jitter: args.jitter,
    }),
    waitMs,
  )
  return { retry: true, delayMs, reason }
}
