import { openTurnOf } from '@dltech/atlas-core'
import { logFieldsOf } from '@dltech/atlas-observability'

import type { HeldSessionDeps } from './held-session-deps'
import type { SessionRecord } from './record/record-adapter'
import { turnEndDraftsOf } from './turn-end-drafts'
import type { TurnEnding } from './turn-boundary'

export const closeOpenTurn = async (args: {
  deps: HeldSessionDeps
  record: SessionRecord | undefined
  ending: TurnEnding
}): Promise<void> => {
  const record = args.record
  if (record === undefined) return
  const open = openTurnOf(record.eventCache().eventsAfter(0))
  if (open === null) return
  try {
    await record.append({
      threadId: record.threadId,
      runId: args.deps.ids.nextRunId(),
      drafts: turnEndDraftsOf({
        events: record.eventCache().eventsAfter(0),
        turnId: open.turnId,
        ending: args.ending,
      }),
    })
  } catch (error) {
    args.deps.log?.warn({
      source: 'holder.turn',
      message: `closing the open turn ${open.turnId} of ${args.deps.sessionId} failed`,
      ...logFieldsOf({ error }),
    })
  }
}
