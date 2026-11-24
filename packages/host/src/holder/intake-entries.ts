import {
  INBOX_KIND_EVENT,
  INBOX_KIND_RECORD,
  INBOX_KIND_RETRY,
  INBOX_KIND_STOP,
  retryReopenDraftsOf,
  type InboxEntry,
  type V2Event,
} from '@dltech/atlas-core'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'
import { INBOX_KIND_OPERATOR_ANSWER } from '@dltech/atlas-plugin-operator/core'

import { childRetryAgentIdOf } from './child-retry'
import { isResizeEntry } from './held-inbox'
import { consumeQuietly, consumeUnknown, runCommand, type CommandGlue } from './command-intake-glue'
import { ESkillDrafts, isCommandKind } from './command-intake'
import { EIntakeScope, skipsInChildScope } from './intake-scope'
import { drainEventEntry, stagedMessageOf, type DraftRelease } from './notice-drain'
import type { OperatorAnswerIntake } from './operator-answer'
import type { AppendDrafts, StagedDrainable } from './staged-log'
import { ETextPlan, type SkillNames } from './text-command'

export type EntryDrain = { drainable: StagedDrainable[]; wakesTurn: boolean }

export const drainEntries = async (args: {
  entries: readonly InboxEntry[]
  events: readonly V2Event[]
  scope: EIntakeScope
  resolved: ReadonlySet<number>
  superseded: ReadonlySet<number>
  glue: CommandGlue
  appendDrafts: AppendDrafts
  skills?: SkillNames | undefined
  release: DraftRelease
  operatorAnswers?: OperatorAnswerIntake | undefined
}): Promise<EntryDrain> => {
  const drainable: StagedDrainable[] = []
  let wakesTurn = false
  let reopened = false
  for (const entry of args.entries) {
    if (args.scope === EIntakeScope.Child && skipsInChildScope(entry)) continue
    if (args.resolved.has(entry.inboxId)) continue
    if (args.superseded.has(entry.inboxId)) {
      await consumeQuietly({ ...args.glue, entry })
      continue
    }
    if (entry.kind === INBOX_KIND_OPERATOR_ANSWER) {
      if ((await args.operatorAnswers?.handle(entry))?.wakesTurn === true) wakesTurn = true
      await consumeQuietly({ ...args.glue, entry })
      continue
    }
    if (entry.kind === INBOX_KIND_STOP) continue
    if (entry.kind === INBOX_KIND_RETRY) {
      if (childRetryAgentIdOf(entry) !== undefined) continue
      const reopen = reopened ? [] : retryReopenDraftsOf({ events: args.events })
      if (reopen.length > 0) {
        reopened = true
        wakesTurn = true
      }
      await consumeQuietly({ ...args.glue, entry, drafts: reopen })
      continue
    }
    if (isResizeEntry(entry)) continue
    if (entry.kind === INBOX_KIND_EVENT || entry.kind === INBOX_KIND_RECORD) {
      if (
        await drainEventEntry({
          entry,
          appendDrafts: args.appendDrafts,
          release: args.release,
        })
      )
        wakesTurn = true
      continue
    }
    if (entry.kind === INBOX_KIND_MESSAGE) {
      const staged = await stagedMessageOf({ entry, appendDrafts: args.appendDrafts })
      if (staged === undefined) continue
      const intake = args.glue.commandIntake
      if (intake === undefined) {
        drainable.push(staged)
        continue
      }
      const plan = await intake.planText(staged.message.text, args.skills)
      if (plan.kind === ETextPlan.Message) {
        drainable.push(staged)
        continue
      }
      if (plan.kind === ETextPlan.Skill) {
        const result = await intake.draftsOfSkill(plan)
        if (result.kind === ESkillDrafts.Loaded) {
          drainable.push({ ...staged, context: result.drafts })
          continue
        }
        if (result.kind === ESkillDrafts.Refused) {
          await intake.refuseText({ entry, message: staged.message, reason: result.reason })
          continue
        }
        drainable.push(staged)
        continue
      }
      if (plan.kind === ETextPlan.Command && (await args.glue.turnOpen())) {
        await intake.stageText({ entry, message: staged.message })
        continue
      }
      await intake.runText({ entry, message: staged.message, plan })
      continue
    }
    if (isCommandKind(entry.kind)) {
      await runCommand({ ...args.glue, entry })
      continue
    }
    await consumeUnknown({ ...args.glue, entry })
  }
  return { drainable, wakesTurn }
}
