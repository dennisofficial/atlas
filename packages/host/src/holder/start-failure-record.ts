import { chainEvents, EHeldOutcome, type Lease, type ThreadId } from '@dltech/atlas-core'
import { logFieldsOf } from '@dltech/atlas-observability'

import { readFullInbox } from './held-inbox'
import type { HeldSessionDeps } from './held-session-deps'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const recordStartFailure = async (args: {
  deps: HeldSessionDeps
  threadId: ThreadId
  epoch: number
  reason: string
  permanent: boolean
}): Promise<boolean> => {
  const { deps } = args
  try {
    const entries = await readFullInbox(deps)
    const events = chainEvents({
      threadId: args.threadId,
      runId: deps.ids.nextRunId(),
      epoch: args.epoch,
      at: new Date(deps.timers.now()).toISOString(),
      from: await deps.plane.head({ threadId: args.threadId }),
      bodies: [
        {
          type: 'session-start-failed',
          reason: args.reason,
          inboxHead: Math.max(0, ...entries.map((entry) => entry.inboxId)),
          permanent: args.permanent,
        },
      ],
    })
    const outcome = await deps.plane.append({
      threadId: args.threadId,
      epoch: args.epoch,
      events,
    })
    return outcome.ok
  } catch (error) {
    deps.log?.error({
      source: 'holder.start-failure',
      message: `recording the start failure of ${deps.sessionId} failed`,
      ...logFieldsOf({ error }),
    })
    return false
  }
}

export const giveUpStarting = async (args: {
  deps: HeldSessionDeps
  threadId: ThreadId
  epoch: number
  error: unknown
}): Promise<boolean> => {
  const verdict = args.deps.judgeStartFailure?.(args.error)
  if (verdict === undefined || !verdict.giveUp) return false
  return recordStartFailure({
    deps: args.deps,
    threadId: args.threadId,
    epoch: args.epoch,
    reason: messageOf(args.error),
    permanent: verdict.permanent,
  })
}

export const startFailureOutcome = async (args: {
  deps: HeldSessionDeps
  threadId: ThreadId
  lease: Lease
  error: unknown
}): Promise<EHeldOutcome> => {
  const gaveUp = await giveUpStarting({
    deps: args.deps,
    threadId: args.threadId,
    epoch: args.lease.epoch,
    error: args.error,
  })
  return gaveUp ? EHeldOutcome.GaveUp : EHeldOutcome.StartFailed
}

export const quarantineOutcome = async (args: {
  deps: HeldSessionDeps
  threadId: ThreadId
  lease: Lease
}): Promise<EHeldOutcome> => {
  const recorded = await recordStartFailure({
    deps: args.deps,
    threadId: args.threadId,
    epoch: args.lease.epoch,
    reason: `this session stopped its host ${args.lease.attempts - 1} times in a row`,
    permanent: false,
  })
  return recorded ? EHeldOutcome.GaveUp : EHeldOutcome.StartFailed
}
