import {
  DEFAULT_RETRY_POLICY,
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  planRetry,
  retryReasonOf,
  type Assembled,
  type ChunkFilter,
  type ModelPort,
  type NormalizedProviderFailure,
  type RetryPolicy,
  type ToolDeclaration,
} from '@dltech/atlas-core'

import { preparedFailureMessage, type PreparedStep } from './step-prepare'

import { blockedErrorOf, type ModelAdmissionBlockedError } from '../model/admission-blocked'
import { causeChainOf } from '../model/cause-chain'
import type { NormalizeFailure } from '../model/run-failure'
import { takeModelStep, type SteppedTurn } from './model-step'
import {
  recordedWaitMs,
  waitOutPendingBackoff,
  type RetryLedgerRef,
  type Waiting,
} from './retry-ledger'

export type { RetryNotice, Waiting } from './retry-ledger'

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
  failover?: (() => boolean) | undefined
  now?: (() => number) | undefined
  ledger?: RetryLedgerRef | undefined
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
  | {
      ok: false
      message: string
      cause: unknown
      thrown: boolean
      blocked?: ModelAdmissionBlockedError | undefined
    }

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
    return {
      ok: false,
      message: stepped.message,
      cause: stepped.cause,
      thrown: false,
      blocked: blockedErrorOf(causeChainOf(stepped.cause)),
    }
  } catch (error) {
    return {
      ok: false,
      message: messageOf(error),
      cause: error,
      thrown: true,
      blocked: blockedErrorOf(causeChainOf(error)),
    }
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
  normalizeFailure: NormalizeFailure
  prepare?: (() => Promise<PreparedStep>) | undefined
}): Promise<SteppedTurn> {
  const policy = args.retry?.policy ?? DEFAULT_RETRY_POLICY
  const sleep = args.retry?.sleep ?? sleepUnlessAborted
  const jitter = args.retry?.jitter ?? Math.random
  const now = args.retry?.now ?? Date.now
  const failover = args.retry?.failover

  let wake = new AbortController()
  const stopWatching = args.retry?.clockJumps?.onJump(() => wake.abort())

  try {
    let attempts = 0
    let gaveUp = false
    let assembled = args.assembled
    const ledger = args.retry?.ledger

    if (ledger !== undefined) {
      attempts = await waitOutPendingBackoff({
        ref: ledger,
        nowMs: now(),
        maxAttempts: policy.maxAttempts,
        onWaiting: args.retry?.onWaiting,
        sleep: async (ms) => {
          await interruptibleSleep({
            ms,
            callerSignal: args.signal,
            jumpSignal: wake.signal,
            sleep,
          })
          if (wake.signal.aborted) wake = new AbortController()
        },
      })
      if (args.signal.aborted) {
        return {
          ok: false,
          message: 'aborted while waiting out a recorded retry deadline',
          cause: args.signal.reason,
        }
      }
    }

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

      if (attempt.blocked !== undefined) {
        return {
          ok: false,
          message: attempt.message,
          cause: attempt.cause,
          blocked: attempt.blocked,
        }
      }

      attempts += 1

      const nowMs = now()
      const failure = args.normalizeFailure({
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
        const consulted = mayConsult && failover?.() === true
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

      const waitMs =
        ledger === undefined
          ? decision.delayMs
          : await recordedWaitMs({
              ref: ledger,
              attempt: attempts,
              delayMs: decision.delayMs,
              reason: decision.reason,
              nowMs,
              now,
            })
      await interruptibleSleep({
        ms: waitMs,
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
