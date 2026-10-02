import { EKilledBy, type ThreadId } from '@dltech/atlas-core'

import { withDeadline } from './drain-deadline'
import { EServeEvent, type ServeLog } from './serve-log'
import type { ServeTurnDriver } from './turn-driver'

export const ROTATION_SETTLE_MS = 30_000

export const ROTATION_ENDINGS_MS = 10_000

export const REPLY_FLUSH_MS = 25

export type DrainResult = { ok: true; paused: boolean }

export type ServeDrain = (args: { reason: string }) => Promise<DrainResult>

export function createServeDrain(args: {
  threadId: ThreadId
  driver: Pick<ServeTurnDriver, 'busy' | 'beginRelocation' | 'settled'>
  closeAdmission: () => void
  endProcesses: (args: { killedBy: EKilledBy }) => Promise<void>
  seal: () => Promise<void>
  retire: (args: { reason: string }) => Promise<void>
  log: ServeLog
  settleMs?: number | undefined
  endingsMs?: number | undefined
  replyFlushMs?: number | undefined
}): ServeDrain {
  let draining: Promise<DrainResult> | undefined

  const failed = (step: string, failure: unknown): void =>
    args.log({
      event: EServeEvent.DrainStepFailed,
      threadId: args.threadId,
      step,
      reason: failure instanceof Error ? failure.message : String(failure),
    })

  const run = async (reason: string): Promise<DrainResult> => {
    args.closeAdmission()
    const paused = args.driver.busy()
    args.log({ event: EServeEvent.DrainRequested, threadId: args.threadId, reason, paused })
    args.driver.beginRelocation()
    await withDeadline({
      task: args.driver.settled().catch((failure: unknown) => failed('settle', failure)),
      ms: args.settleMs ?? ROTATION_SETTLE_MS,
    })
    await withDeadline({
      task: args.endProcesses({ killedBy: EKilledBy.Rotation }).catch((failure: unknown) => failed('endings', failure)),
      ms: args.endingsMs ?? ROTATION_ENDINGS_MS,
    })
    await args.seal().then(
      () => args.log({ event: EServeEvent.DrainSealed, threadId: args.threadId }),
      (failure: unknown) => failed('seal', failure),
    )
    setTimeout(() => void args.retire({ reason }), args.replyFlushMs ?? REPLY_FLUSH_MS)
    return { ok: true, paused }
  }

  return ({ reason }) => {
    draining ??= run(reason).catch((failure: unknown) => {
      draining = undefined
      failed('drain', failure)
      throw failure
    })
    return draining
  }
}
