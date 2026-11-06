import type { ERetryReason, ScheduledRetry } from '@dltech/atlas-core'

import type { OnceLedger } from './once-ledger.port'

export type RetryNotice = {
  attempt: number
  maxAttempts: number
  delayMs: number
  reason: ERetryReason
}

export type Waiting = (notice: RetryNotice) => void

export type RetryLedgerRef = {
  onceLedger: OnceLedger
  stepKey: string
}

export class HandoffAborted extends Error {
  constructor() {
    super('model step aborted for handoff')
    this.name = 'HandoffAborted'
  }
}

export const throwIfHandoff = (signal: AbortSignal): void => {
  if (signal.aborted && signal.reason === 'handoff') throw new HandoffAborted()
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

export async function pendingBackoff(args: { ref: RetryLedgerRef; nowMs: number }): Promise<
  | {
      attempt: number
      backoff: Pick<ScheduledRetry, 'notBefore' | 'reason'>
      remainingMs: number
    }
  | undefined
> {
  const retries = await args.ref.onceLedger.recallRetries({ prefix: `${args.ref.stepKey}:` })
  const last = retries.at(-1)
  if (last === undefined) return undefined
  const remainingMs = Date.parse(last.notBefore) - args.nowMs
  return {
    attempt: last.attempt,
    backoff: { notBefore: last.notBefore, reason: last.reason },
    remainingMs,
  }
}

export async function settleRecordedDeadline(args: {
  ref: RetryLedgerRef
  nowMs: number
  maxAttempts: number
  onWaiting: Waiting | undefined
  sleep: (ms: number) => Promise<void>
}): Promise<number> {
  const pending = await pendingBackoff({ ref: args.ref, nowMs: args.nowMs })
  if (pending === undefined) return 0
  if (pending.remainingMs > 0) {
    args.onWaiting?.({
      attempt: pending.attempt,
      maxAttempts: args.maxAttempts,
      delayMs: pending.remainingMs,
      reason: pending.backoff.reason,
    })
    await args.sleep(pending.remainingMs)
  }
  return pending.attempt
}

export async function recordedWaitMs(args: {
  ref: RetryLedgerRef
  attempt: number
  delayMs: number
  reason: ERetryReason
  nowMs: number
  now: () => number
}): Promise<number> {
  const recorded = await args.ref.onceLedger.scheduleRetry({
    key: `${args.ref.stepKey}:${args.attempt}`,
    decide: () =>
      Promise.resolve({
        notBefore: new Date(args.nowMs + args.delayMs).toISOString(),
        attempt: args.attempt,
        reason: args.reason,
      }),
  })
  return Math.max(0, Date.parse(recorded.notBefore) - args.now())
}

/**
 * A clock jump cannot abort the caller's signal, so the backoff sleeps on a signal linked to
 * both: the jump cuts the sleep short, and a caller abort during the backoff still settles it.
 */
export function interruptibleSleep(args: {
  ms: number
  callerSignal: AbortSignal
  jumpSignal: AbortSignal
  sleep: (args: { ms: number; signal: AbortSignal }) => Promise<void>
}): Promise<void> {
  if (args.jumpSignal.aborted) return args.sleep({ ms: args.ms, signal: args.callerSignal })
  return args.sleep({ ms: args.ms, signal: AbortSignal.any([args.callerSignal, args.jumpSignal]) })
}
