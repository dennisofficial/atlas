import { chainEvents, type ThreadId } from '@dltech/atlas-core'
import { logFieldsOf } from '@dltech/atlas-observability'

import { readFullInbox } from './held-inbox'
import type { HeldSessionDeps } from './held-session-deps'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const giveUpStarting = async (args: {
  deps: HeldSessionDeps
  threadId: ThreadId
  epoch: number
  error: unknown
}): Promise<boolean> => {
  const { deps } = args
  const verdict = deps.judgeStartFailure?.(args.error)
  if (verdict === undefined || !verdict.giveUp) return false
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
          reason: messageOf(args.error),
          inboxHead: Math.max(0, ...entries.map((entry) => entry.inboxId)),
          permanent: verdict.permanent,
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
