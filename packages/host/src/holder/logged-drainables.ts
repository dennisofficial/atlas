import type { RecordEvent } from '@dltech/atlas-core'

import { ESkillDrafts, type CommandIntake } from './command-intake'
import { loggedMessagesOf, type AppendDrafts, type Drainable } from './staged-log'
import { ETextPlan, type SkillNames } from './text-command'

export const consumedInboxIdsOf = (events: readonly RecordEvent[]): ReadonlySet<number> =>
  new Set(events.flatMap((event) => (event.type === 'input-consumed' ? [event.inboxId] : [])))

const NO_SKILL_NAMES: SkillNames = async () => []

export const skillsForPassOf = (intake: CommandIntake | undefined): SkillNames =>
  intake === undefined ? NO_SKILL_NAMES : intake.skillsForPass()

export const loggedDrainablesOf = async (args: {
  events: readonly RecordEvent[]
  staged: ReadonlySet<number>
  skills: SkillNames
  intake: CommandIntake | undefined
  appendDrafts: AppendDrafts
}): Promise<Drainable[]> => {
  const drainable: Drainable[] = []
  for (const item of loggedMessagesOf({ events: args.events })) {
    if (args.staged.has(item.inboxId)) continue
    if (args.intake === undefined) {
      drainable.push({ inboxId: item.inboxId, message: item.message, posted: true })
      continue
    }
    const plan = await args.intake.planText(item.message.text, args.skills)
    if (plan.kind === ETextPlan.Command) continue
    if (plan.kind === ETextPlan.Skill) {
      const result = await args.intake.draftsOfSkill(plan)
      if (result.kind === ESkillDrafts.Loaded) {
        drainable.push({
          inboxId: item.inboxId,
          message: item.message,
          posted: true,
          context: result.drafts,
        })
        continue
      }
      if (result.kind === ESkillDrafts.Refused) {
        await args.appendDrafts([
          { type: 'input-refused', inboxId: item.inboxId, reason: result.reason },
        ])
        continue
      }
    }
    drainable.push({ inboxId: item.inboxId, message: item.message, posted: true })
  }
  return drainable
}
