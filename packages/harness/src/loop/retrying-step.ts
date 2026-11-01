import {
  DEFAULT_RETRY_POLICY,
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  planRetry,
  retryReasonOf,
  type Assembled,
  type ChunkFilter,
  type ERetryReason,
  type ModelPort,
  type NormalizedProviderFailure,
  type RetryPolicy,
  type ToolDeclaration,
} from '@dltech/atlas-core'

import { preparedFailureMessage, type PreparedStep } from './step-prepare'

import { normalizeProviderFailure } from '../model/failure'
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
  log?:
    | ((entry: {
        attempt: number
        maxAttempts: number
        reason: string
        willRetry: boolean
        error: unknown
      }) => void)
    | undefined
  /**
   * Consulted at most once per step, and only when the failure says this model cannot continue: a
   * transient fault that spent the whole attempt budget, or a credential-scoped quota/auth
   * rejection. Returning true means the model has been switched to a fallback worth a fresh
   * budget, granted once; returning false (or leaving it unset) settles the failure. Permanent
   * request, route and delivery faults never consult it.
   */
  onGiveUp?: (() => boolean) | undefined
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

const asksToGiveUp = (failure: NormalizedProviderFailure, spent: boolean): boolean => {
  if (failure.retry === EProviderRetry.Transient) return spent
  return (
    failure.scope === EProviderFailureScope.Credential &&
    (failure.kind === EProviderFailureKind.Quota || failure.kind === EProviderFailureKind.Auth)
  )
}

/**
 * A clock jump cuts the in-progress backoff short so a woken machine retries on fresh
 * connections, but it never refunds attempts: five provider attempts is a hard cap per step.
 */
export async function takeModelStepWithRetry(args: {
  model: ModelPort
  tools: readonly ToolDeclaration[]
  onChunk: ChunkFilter | undefined
  assembled: Assembled
  signal: AbortSignal
  retry?: RetryDeps | undefined
  prepare?: (() => Promise<PreparedStep>) | undefined
}): Promise<SteppedTurn> {
  const policy = args.retry?.policy ?? DEFAULT_RETRY_POLICY
  const sleep = args.retry?.sleep ?? sleepUnlessAborted
  const jitter = args.retry?.jitter ?? Math.random

  let wake = new AbortController()
  const stopWatching = args.retry?.clockJumps?.onJump(() => wake.abort())

  try {
    let attempts = 0
    let gaveUp = false
    let assembled = args.assembled

    for (;;) {
      const attempt = await attemptModelStep({
        model: args.model,
        tools: args.tools,
        onChunk: args.onChunk,
        assembled,
        signal: args.signal,
      })

      if (attempt.ok) return attempt.stepped

      const settled = (): SteppedTurn => {
        if (attempt.thrown) throw attempt.cause
        return { ok: false, message: attempt.message, cause: attempt.cause }
      }

      if (args.signal.aborted) return settled()

      attempts += 1

      const nowMs = Date.now()
      const failure = normalizeProviderFailure({
        cause: attempt.cause,
        message: attempt.message,
        providerId: args.model.identity.id,
        modelId: args.model.identity.modelId,
        cancelled: args.signal.aborted,
        nowMs,
      })
      const decision = planRetry({ failure, attempts, policy, jitter: jitter(), nowMs })

      if (!decision.retry) {
        const mayConsult = !gaveUp && asksToGiveUp(failure, attempts >= policy.maxAttempts)
        if (mayConsult) gaveUp = true
        const consulted = mayConsult && args.retry?.onGiveUp?.() === true
        args.retry?.log?.({
          attempt: attempts,
          maxAttempts: policy.maxAttempts,
          reason: retryReasonOf(failure) ?? 'non-retryable',
          willRetry: consulted,
          error: attempt.cause,
        })
        if (!consulted) return settled()
        attempts = 0
        continue
      }

      args.retry?.log?.({
        attempt: attempts,
        maxAttempts: policy.maxAttempts,
        reason: decision.reason,
        willRetry: true,
        error: attempt.cause,
      })
      args.retry?.onWaiting?.({
        attempt: attempts,
        maxAttempts: policy.maxAttempts,
        delayMs: decision.delayMs,
        reason: decision.reason,
      })

      await interruptibleSleep({
        ms: decision.delayMs,
        callerSignal: args.signal,
        jumpSignal: wake.signal,
        sleep,
      })
      if (wake.signal.aborted) wake = new AbortController()
      if (args.signal.aborted) return settled()

      if (args.prepare !== undefined) {
        try {
          for (;;) {
            args.signal.throwIfAborted()
            const prepared = await args.prepare()
            if (!prepared.ok) return { ok: false, ...preparedFailureMessage(prepared) }
            if ('compacted' in prepared) continue
            assembled = prepared.assembled
            break
          }
        } catch (error) {
          if (args.signal.aborted) return settled()
          return { ok: false, message: messageOf(error), cause: error }
        }
      }
    }
  } finally {
    stopWatching?.()
  }
}
