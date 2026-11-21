import { unfinishedCommandIdsOf, type ControlPlane } from '@dltech/atlas-control'
import { visibleEvents } from '@dltech/atlas-core'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import { isCommandKind, type CommandIntake } from './command-intake'
import type { SessionRecord } from './record/record-adapter'

export const recoverUnfinishedCommands = async (params: {
  intake: CommandIntake
  plane: ControlPlane
  sessionId: string
  record: SessionRecord
  log?: LogPort | undefined
}): Promise<void> => {
  const { intake, plane, sessionId, log } = params
  const visible = visibleEvents(params.record.eventCache().eventsAfter(0))
  for (const inboxId of unfinishedCommandIdsOf(visible)) {
    try {
      const entry = await plane.readInboxEntry({ sessionId, inboxId })
      if (entry === undefined || !isCommandKind(entry.kind)) continue
      log?.info({
        source: 'holder.intake',
        message: `re-running consumed command ${inboxId} of kind "${entry.kind}" after takeover`,
      })
      await intake.replay({ entry })
    } catch (error) {
      log?.error({
        source: 'holder.intake',
        message: `re-running consumed command ${inboxId} failed`,
        ...logFieldsOf({ error }),
      })
    }
  }
}
