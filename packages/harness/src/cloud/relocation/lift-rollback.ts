import { logFieldsOf } from '../../store/logs'
import { flipChildrenBack } from './lift-children'
import type { LiftCtx } from './lift-plan'

/**
 * A committed-but-failed lift left the thread marked Cloud with no working cloud session, so the
 * flip is walked back to where the lift started. Best-effort: each step is swallowed on its own,
 * the title the flip renamed stays renamed, and the sandbox is left standing — the boot reaper
 * owns that lifecycle. Returns true only when the location state and meta both landed back home.
 */
export const rollBackCommittedFlip = async (ctx: LiftCtx): Promise<boolean> => {
  const { args } = ctx
  try {
    args.setLocation(ctx.from)
    if (args.started) {
      await args.localThreads.chooseExecutionLocation({ threadId: args.threadId, location: ctx.from })
    }
    await flipChildrenBack({
      threadId: args.threadId,
      localThreads: args.localThreads,
      agents: args.agents,
      location: ctx.from,
    })
  } catch (error) {
    ctx.logPort?.warn({
      source: 'cloud.lift',
      message: 'the lift rollback did not finish — the conversation may still read as cloud',
      threadId: args.threadId,
      data: { operation: 'rollback-committed-flip' },
      ...logFieldsOf({ error }),
    })
    return false
  }
  ctx.logPort?.warn({
    source: 'cloud.lift',
    message: 'the committed lift was rolled back; the orphaned sandbox is left to the boot reaper',
    threadId: args.threadId,
    data: { operation: 'rollback-committed-flip' },
  })
  return true
}
