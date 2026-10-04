import { EKilledBy, type ThreadId } from '@dltech/atlas-core'
import type { SandboxDrainReply, SandboxRotationReceipt } from '@dltech/atlas-wire'

import { EServeEvent, type ServeLog } from './serve-log'
import type { ServeTurnDriver } from './turn-driver'

export const REPLY_FLUSH_MS = 25

export type DrainResult = SandboxDrainReply
export type ServeDrain = (args: { reason: string }) => Promise<DrainResult>

export function createServeDrain(args: {
  threadId: ThreadId
  driver: Pick<ServeTurnDriver, 'beginRelocation' | 'relocationResumable'>
  closeAdmission: () => void
  beginPreparation: () => Promise<void>
  endProcesses: (args: { killedBy: EKilledBy }) => Promise<void>
  flushInput: () => Promise<void>
  seal: (args: { resumeParent: boolean }) => Promise<SandboxRotationReceipt>
  retire: (args: { reason: string }) => Promise<void>
  log: ServeLog
  replyFlushMs?: number | undefined
}): ServeDrain {
  let draining: Promise<DrainResult> | undefined

  const run = async (reason: string): Promise<DrainResult> => {
    args.closeAdmission()
    args.log({ event: EServeEvent.DrainRequested, threadId: args.threadId, reason })
    await args.beginPreparation()
    await args.driver.beginRelocation()
    await args.endProcesses({ killedBy: EKilledBy.Rotation })
    await args.flushInput()
    const receipt = await args.seal({ resumeParent: args.driver.relocationResumable() })
    args.log({ event: EServeEvent.DrainSealed, threadId: args.threadId })
    setTimeout(() => {
      void args.retire({ reason }).catch((failure: unknown) => {
        args.log({
          event: EServeEvent.DrainStepFailed,
          step: 'retire',
          reason: failure instanceof Error ? failure.message : String(failure),
        })
      })
    }, args.replyFlushMs ?? REPLY_FLUSH_MS)
    return { ok: true, prepared: true, receipt }
  }

  return ({ reason }) => {
    draining ??= run(reason).catch((failure: unknown) => {
      draining = undefined
      args.log({
        event: EServeEvent.DrainStepFailed,
        threadId: args.threadId,
        step: 'prepare',
        reason: failure instanceof Error ? failure.message : String(failure),
      })
      throw failure
    })
    return draining
  }
}
