import {
  INBOX_KIND_EVENT,
  INBOX_KIND_RETRY,
  INBOX_KIND_STOP,
  type InboxEntry,
} from '@dltech/atlas-core'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'
import { INBOX_KIND_OPERATOR_ANSWER } from '@dltech/atlas-plugin-operator/core'

import { consumeQuietly, consumeUnknown, runCommand, type CommandGlue } from './command-intake-glue'
import { isCommandKind } from './command-intake'
import { EIntakeScope, skipsInChildScope } from './intake-scope'
import { drainEventEntry, stagedMessageOf, type StagedMessage } from './notice-drain'
import type { OperatorAnswerIntake } from './operator-answer'
import type { AppendDrafts } from './staged-log'

export type EntryDrain = { drainable: StagedMessage[]; wakesTurn: boolean }

export const drainEntries = async (args: {
  entries: readonly InboxEntry[]
  scope: EIntakeScope
  resolved: ReadonlySet<number>
  superseded: ReadonlySet<number>
  glue: CommandGlue
  appendDrafts: AppendDrafts
  operatorAnswers?: OperatorAnswerIntake | undefined
}): Promise<EntryDrain> => {
  const drainable: StagedMessage[] = []
  let wakesTurn = false
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
      await consumeQuietly({ ...args.glue, entry })
      continue
    }
    if (entry.kind === INBOX_KIND_EVENT) {
      if (await drainEventEntry({ entry, appendDrafts: args.appendDrafts })) wakesTurn = true
      continue
    }
    if (entry.kind === INBOX_KIND_MESSAGE) {
      const staged = await stagedMessageOf({ entry, appendDrafts: args.appendDrafts })
      if (staged !== undefined) drainable.push(staged)
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
