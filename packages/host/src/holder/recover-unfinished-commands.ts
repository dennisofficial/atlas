import { unfinishedCommandIdsOf, type ControlPlane } from '@dltech/atlas-control'
import { commandInputName, producesOutcome, visibleEvents } from '@dltech/atlas-core'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import { isCommandKind, type CommandIntake } from './command-intake'
import type { SessionRecord } from './record/record-adapter'
import { salvagedOf } from './staged-log'
import { ETextPlan } from './text-command'

export const recoverUnfinishedCommands = async (params: {
  intake: CommandIntake
  plane: ControlPlane
  sessionId: string
  record: SessionRecord
  log?: LogPort | undefined
}): Promise<void> => {
  const { intake, plane, sessionId, log } = params
  const visible = visibleEvents(params.record.eventCache().eventsAfter(0))
  const skills = await intake.skillsForPass()
  for (const inboxId of unfinishedCommandIdsOf(visible)) {
    try {
      const entry = await plane.readInboxEntry({ sessionId, inboxId })
      if (entry === undefined) continue
      if (isCommandKind(entry.kind)) {
        if (!producesOutcome(commandInputName(entry.kind))) continue
        log?.info({
          source: 'holder.intake',
          message: `re-running consumed command ${inboxId} of kind "${entry.kind}" after takeover`,
        })
        await intake.replay({ entry })
        continue
      }
      if (entry.kind !== INBOX_KIND_MESSAGE) continue
      const text = salvagedOf(entry.payload).message?.text
      if (text === undefined) continue
      const plan = await intake.planText(text, skills)
      if (plan.kind !== ETextPlan.Command || !('pod' in plan.run)) continue
      if (!producesOutcome(plan.consumed.name)) continue
      log?.info({
        source: 'holder.intake',
        message: `re-running consumed command ${inboxId} typed as text after takeover`,
      })
      await intake.replayText({ entry, plan })
    } catch (error) {
      log?.error({
        source: 'holder.intake',
        message: `re-running consumed command ${inboxId} failed`,
        ...logFieldsOf({ error }),
      })
    }
  }
}
