import {
  awaitsReplyOf,
  EInputConsumed,
  pendingInputsOf,
  type InboxEntry,
  type ThreadId,
  type V2Event,
} from '@dltech/atlas-core'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'
import type { LogPort } from '@dltech/atlas-observability'

import { isCommandKind, type CommandIntake } from './command-intake'
import type { SessionRecord } from './record/record-adapter'
import type { AppendDrafts } from './staged-log'
import { ETextPlan } from './text-command'

export const UNKNOWN_COMMAND_MAX_AGE_MS = 60 * 60 * 1000

export const overAge = (params: { postedAt: string; now: number }): boolean => {
  const posted = Date.parse(params.postedAt)
  return Number.isNaN(posted) || params.now - posted > UNKNOWN_COMMAND_MAX_AGE_MS
}

export type CommandGlue = {
  commandIntake: CommandIntake | undefined
  appendDrafts: AppendDrafts
  turnOpen: () => Promise<boolean>
  now: () => number
  log?: LogPort | undefined
}

export type CommandEntryArgs = CommandGlue & { entry: InboxEntry }

export type LoggedCommandsArgs = CommandGlue & {
  events: readonly V2Event[]
  readEntry: (inboxId: number) => Promise<InboxEntry | undefined>
}

export const turnOpenOf = async (params: {
  record: SessionRecord
  threadId: ThreadId
}): Promise<boolean> => awaitsReplyOf(await params.record.loopState({ threadId: params.threadId }))

export const consumeQuietly = async (params: CommandEntryArgs): Promise<void> => {
  await params.appendDrafts([
    {
      type: 'input-consumed',
      inboxId: params.entry.inboxId,
      consumed: EInputConsumed.Discarded,
    },
  ])
}

export const consumeUnknown = async (params: CommandEntryArgs): Promise<void> => {
  params.log?.warn({
    source: 'holder.intake',
    message: `inbox entry ${params.entry.inboxId} of kind "${params.entry.kind}" is consumed without a draft`,
  })
  await consumeQuietly(params)
}

export const leaveUnknownCommand = async (params: CommandEntryArgs): Promise<void> => {
  if (overAge({ postedAt: params.entry.postedAt, now: params.now() })) {
    await consumeUnknown(params)
    return
  }
  params.log?.info({
    source: 'holder.intake',
    message: `inbox entry ${params.entry.inboxId} of kind "${params.entry.kind}" is left for a holder that knows the kind`,
  })
}

export const runCommand = async (params: CommandEntryArgs): Promise<void> => {
  const resolved = params.commandIntake?.resolve(params.entry)
  if (params.commandIntake === undefined || resolved === undefined) {
    await leaveUnknownCommand(params)
    return
  }
  if (await params.turnOpen()) return
  await params.commandIntake.run({ entry: params.entry, ...resolved })
}

export const runLoggedCommands = async (params: LoggedCommandsArgs): Promise<void> => {
  const intake = params.commandIntake
  if (intake === undefined) return
  for (const input of pendingInputsOf(params.events).pending) {
    if (await params.turnOpen()) return
    if (input.kind === INBOX_KIND_MESSAGE) {
      if (input.message === undefined) continue
      const plan = intake.planText(input.message.text)
      if (plan.kind === ETextPlan.Message) continue
      const entry = await params.readEntry(input.inboxId)
      if (entry === undefined || entry.kind !== INBOX_KIND_MESSAGE) continue
      await intake.runText({ entry, message: input.message, plan })
      continue
    }
    if (!isCommandKind(input.kind)) continue
    const entry = await params.readEntry(input.inboxId)
    if (entry === undefined || !isCommandKind(entry.kind)) continue
    await runCommand({ ...params, entry })
  }
}
