import {
  DEFAULT_RETRY_POLICY,
  planRetry,
  retryReasonOf,
  type Assembled,
  type ChunkFilter,
  type ERetryReason,
  type ModelPort,
  type RetryPolicy,
  type ToolDeclaration,
} from '@dltech/atlas-core'

import { modelFailureOf } from '../model/failure'
import { takeModelStep, type SteppedTurn } from './model-step'

export type RetryNotice = {
  attempt: number
  maxAttempts: number
  delayMs: number
  reason: ERetryReason
}

export type Waiting = (notice: RetryNotice) => void

export type ClockJumpDetector = {
  onJump: (callback: (gapMs: number) => void) => () => void
}

export type RetryDeps = {
  policy?: RetryPolicy | undefined
  onWaiting?: Waiting | undefined
  sleep?: ((args: { ms: number; signal: AbortSignal }) => Promise<void>) | undefined
  jitter?: (() => number) | undefined
  clockJumps?: ClockJumpDetector | undefined
  log?: ((entry: { attempt: number; maxAttempts: number; reason: string; willRetry: boolean; error: unknown }) => void) | undefined
}

export function sleepUnlessAborted(args: { ms: number; signal: AbortSignal }): Promise<void> {
  return new Promise<void>((resolve) => {
    if (args.signal.aborted) {
      resolve()
      return
    }

    const settle = () => {
      clearTimeout(timer)
      args.signal.removeEventListener('abort', settle)
      resolve()
    }

    const timer = setTimeout(settle, args.ms)
    args.signal.addEventListener('abort', settle, { once: true })
  })
}

/**
 * A clock jump cannot abort the caller's signal, so the backoff sleeps on a signal linked to
 * both: the jump cuts the sleep short, and a caller abort during the backoff still settles it.
 */
function interruptibleSleep(args: {
  ms: number
  callerSignal: AbortSignal
  jumpSignal: AbortSignal
  sleep: (args: { ms: number; signal: AbortSignal }) => Promise<void>
}): Promise<void> {
  if (args.jumpSignal.aborted) return args.sleep({ ms: args.ms, signal: args.callerSignal })
  return args.sleep({ ms: args.ms, signal: AbortSignal.any([args.callerSignal, args.jumpSignal]) })
}

type StepAttempt =
  | { ok: true; stepped: SteppedTurn }
  | { ok: false; message: string; cause: unknown; thrown: boolean }

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * `takeModelStep` only converts `ModelStreamError` into a returned failure and rethrows anything
 * else, so a request that fails before the stream opens — a 429 or a refused connection on the
 * initial call — arrives as a throw rather than a result. Both are retried; only a throw is
 * rethrown when the retries run out, so a caller that expected an exception still gets one.
 */
async function attemptModelStep(args: {
  model: ModelPort
  tools: readonly ToolDeclaration[]
  onChunk: ChunkFilter | undefined
  assembled: Assembled
  signal: AbortSignal
}): Promise<StepAttempt> {
  try {
    const stepped = await takeModelStep(args)
    if (stepped.ok) return { ok: true, stepped }
    return { ok: false, message: stepped.message, cause: stepped.cause, thrown: false }
  } catch (error) {
    return { ok: false, message: messageOf(error), cause: error, thrown: true }
  }
}

/**
 * A machine sleep strands the attempts spent before it against dead pooled connections, so a
 * clock jump hands the loop its budget back: the jump aborts the inner sleep, and the next
 * failure after it reads the jump and restarts the counter at attempt 1. One pending jump is
 * consumed once — there is no per-step reset cap because a wake loop cannot stack resets: a jump
 * still flagged from the last reset adds nothing, and only a genuinely new jump resets again.
 */
export async function takeModelStepWithRetry(args: {
  model: ModelPort
  tools: readonly ToolDeclaration[]
  onChunk: ChunkFilter | undefined
  assembled: Assembled
  signal: AbortSignal
  retry?: RetryDeps | undefined
}): Promise<SteppedTurn> {
  const policy = args.retry?.policy ?? DEFAULT_RETRY_POLICY
  const sleep = args.retry?.sleep ?? sleepUnlessAborted
  const jitter = args.retry?.jitter ?? Math.random

  let wake = new AbortController()
  const stopWatching = args.retry?.clockJumps?.onJump(() => wake.abort())
  const consumeJump = (): boolean => {
    if (!wake.signal.aborted) return false
    wake = new AbortController()
    return true
  }

  try {
    let attempts = 0

    for (;;) {
      const attempt = await attemptModelStep({
        model: args.model,
        tools: args.tools,
        onChunk: args.onChunk,
        assembled: args.assembled,
        signal: args.signal,
      })

      if (attempt.ok) return attempt.stepped

      const settled = (): SteppedTurn => {
        if (attempt.thrown) throw attempt.cause
        return { ok: false, message: attempt.message, cause: attempt.cause }
      }

      if (args.signal.aborted) return settled()

      if (consumeJump()) attempts = 0

      attempts += 1

      const failure = modelFailureOf(attempt.cause)
      if (failure === null) {
        args.retry?.log?.({ attempt: attempts, maxAttempts: policy.maxAttempts, reason: 'non-retryable', willRetry: false, error: attempt.cause })
        return settled()
      }

      const decision = planRetry({ failure, attempts, policy, jitter: jitter() })
      if (!decision.retry) {
        args.retry?.log?.({ attempt: attempts, maxAttempts: policy.maxAttempts, reason: retryReasonOf(failure) ?? 'non-retryable', willRetry: false, error: attempt.cause })
        return settled()
      }

      args.retry?.log?.({ attempt: attempts, maxAttempts: policy.maxAttempts, reason: decision.reason, willRetry: true, error: attempt.cause })
      args.retry?.onWaiting?.({
        attempt: attempts,
        maxAttempts: policy.maxAttempts,
        delayMs: decision.delayMs,
        reason: decision.reason,
      })

      await interruptibleSleep({ ms: decision.delayMs, callerSignal: args.signal, jumpSignal: wake.signal, sleep })
      if (args.signal.aborted) return settled()
    }
  } finally {
    stopWatching?.()
  }
}
