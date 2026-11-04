import type { ERetryReason } from '@dltech/atlas-core'

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

export type RecordedBackoff = {
  notBefore: string
  reason: ERetryReason
}

const attemptOfKey = (key: string): number | undefined => {
  const attempt = Number(key.slice(key.lastIndexOf(':') + 1))
  return Number.isInteger(attempt) && attempt > 0 ? attempt : undefined
}

const backoffOfValue = (value: unknown): RecordedBackoff | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const held = value as { notBefore?: unknown; reason?: unknown }
  if (typeof held.notBefore !== 'string' || typeof held.reason !== 'string') return undefined
  if (!Number.isFinite(Date.parse(held.notBefore))) return undefined
  return { notBefore: held.notBefore, reason: held.reason as ERetryReason }
}

export async function pendingBackoff(args: {
  ref: RetryLedgerRef
  nowMs: number
}): Promise<{ attempt: number; backoff: RecordedBackoff; remainingMs: number } | undefined> {
  const facts = await args.ref.onceLedger.recall({ prefix: `${args.ref.stepKey}:` })
  const last = facts.at(-1)
  if (last === undefined) return undefined
  const attempt = attemptOfKey(last.key)
  const backoff = backoffOfValue(last.value)
  if (attempt === undefined || backoff === undefined) return undefined
  const remainingMs = Date.parse(backoff.notBefore) - args.nowMs
  return { attempt, backoff, remainingMs }
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
  const recorded = await args.ref.onceLedger.once<RecordedBackoff>({
    key: `${args.ref.stepKey}:${args.attempt}`,
    decide: () =>
      Promise.resolve({
        notBefore: new Date(args.nowMs + args.delayMs).toISOString(),
        reason: args.reason,
      }),
  })
  return Math.max(0, Date.parse(recorded.notBefore) - args.now())
}
