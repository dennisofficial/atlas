import { z } from 'zod'

import {
  attachmentSchema,
  attachmentsOf,
  INBOX_KIND_RETRY,
  INBOX_KIND_STOP,
  pendingInputsOf,
  type Attachment,
  type EMessageOrigin,
  type EventDraft,
  type InboxEntry,
  type PluginEventBody,
  type RecordBody,
  type V2Event,
} from '@dltech/atlas-core'
import { INBOX_KIND_WITHDRAW } from '@dltech/atlas-control'
import type { Command, CommandHandler } from '@dltech/atlas-commands'
import { INBOX_KIND_MESSAGE, inboxMessageSchema, type InboxMessage } from '@dltech/atlas-protocol'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import { isCommandKind } from './command-intake'

export type AppendDrafts = (
  drafts: readonly (EventDraft | RecordBody | PluginEventBody)[],
) => Promise<void>

type ResolvedCommand = { command: Command; handler: CommandHandler<unknown> } | undefined

type MessageFields = {
  text?: string | undefined
  clientId?: string | undefined
  attachments?: readonly Attachment[] | undefined
  via?: EMessageOrigin | undefined
}

export const jsonOf = (payload: string): unknown => {
  try {
    return JSON.parse(payload)
  } catch {
    return undefined
  }
}

export const messageFieldsOf = (message: InboxMessage): MessageFields => {
  const attachments = attachmentsOf(message)
  return {
    text: message.text,
    ...(message.clientId === undefined ? {} : { clientId: message.clientId }),
    ...(attachments.length === 0 ? {} : { attachments }),
    ...(message.via === undefined ? {} : { via: message.via }),
  }
}

export const salvagedFieldsOf = (payload: string): MessageFields => {
  const raw = jsonOf(payload)
  if (typeof raw !== 'object' || raw === null) return {}
  const record = raw as Record<string, unknown>
  const text = typeof record.text === 'string' ? record.text : undefined
  const clientId =
    typeof record.clientId === 'string' && record.clientId.length > 0 ? record.clientId : undefined
  const attachments = z.array(attachmentSchema).safeParse(record.attachments)
  return {
    ...(text === undefined ? {} : { text }),
    ...(clientId === undefined ? {} : { clientId }),
    ...(attachments.success ? { attachments: attachments.data } : {}),
  }
}

const postedDraft = (params: { entry: InboxEntry; fields: MessageFields }): RecordBody => ({
  type: 'input-posted',
  inboxId: params.entry.inboxId,
  kind: params.entry.kind,
  postedAt: params.entry.postedAt,
  ...params.fields,
})

export const postedDraftsOf = (params: {
  entry: InboxEntry
  resolveCommand: (entry: InboxEntry) => ResolvedCommand
}): RecordBody[] => {
  const { entry } = params
  if (entry.kind === INBOX_KIND_STOP || entry.kind === INBOX_KIND_RETRY) return []
  if (entry.kind === INBOX_KIND_WITHDRAW) return []
  if (entry.kind === INBOX_KIND_MESSAGE) {
    const parsed = inboxMessageSchema.safeParse(jsonOf(entry.payload))
    if (!parsed.success) return []
    return [postedDraft({ entry, fields: messageFieldsOf(parsed.data) })]
  }
  if (isCommandKind(entry.kind) && params.resolveCommand(entry) === undefined) return []
  return [postedDraft({ entry, fields: {} })]
}

export const postedInboxIdsOf = (params: { events: readonly V2Event[] }): ReadonlySet<number> => {
  const pending = pendingInputsOf(params.events).pending
  return new Set(pending.map((entry) => entry.inboxId))
}

export type Drainable = { entry: InboxEntry; message: InboxMessage; posted: boolean }

export const drainOrderOf = (params: {
  staged: readonly { entry: InboxEntry; message: InboxMessage }[]
  logged: readonly { entry: InboxEntry; message: InboxMessage }[]
  posted: ReadonlySet<number>
}): Drainable[] => {
  const known = new Set(params.staged.map((item) => item.entry.inboxId))
  const logged = params.logged.flatMap((item) =>
    known.has(item.entry.inboxId) ? [] : [{ ...item, posted: true }],
  )
  const staged = params.staged.map((item) => ({
    ...item,
    posted: params.posted.has(item.entry.inboxId),
  }))
  return [...staged, ...logged].sort((left, right) => left.entry.inboxId - right.entry.inboxId)
}

export const stagedMessagesOf = (params: {
  events: readonly V2Event[]
  sessionId: string
}): { entry: InboxEntry; message: InboxMessage }[] =>
  pendingInputsOf(params.events).pending.flatMap((pending) => {
    if (pending.kind !== INBOX_KIND_MESSAGE || pending.text === undefined) return []
    return [
      {
        entry: {
          sessionId: params.sessionId,
          inboxId: pending.inboxId,
          kind: pending.kind,
          payload: JSON.stringify({
            text: pending.text,
            ...(pending.attachments === undefined ? {} : { attachments: pending.attachments }),
          }),
          postedAt: pending.at,
          consumedSeq: pending.seq,
          senderSessionId: pending.sender?.session ?? null,
        },
        message: {
          text: pending.text,
          ...(pending.via === undefined ? {} : { via: pending.via }),
          ...(pending.clientId === undefined ? {} : { clientId: pending.clientId }),
          ...(pending.attachments === undefined ? {} : { attachments: [...pending.attachments] }),
        },
      },
    ]
  })

export const logStagedInputs = async (params: {
  fetch: () => Promise<InboxEntry[]>
  resolveWithdraws: (entries: readonly InboxEntry[]) => Promise<ReadonlySet<number>>
  postedDraftsOf: (entry: InboxEntry) => RecordBody[]
  appendDrafts: AppendDrafts
  willDrain?: (() => boolean) | undefined
  prepared?: (() => boolean) | undefined
  log?: LogPort | undefined
}): Promise<void> => {
  try {
    const entries = await params.fetch()
    if (params.willDrain?.() === true) return
    const resolved = await params.resolveWithdraws(entries)
    const drafts = entries
      .filter((entry) => !resolved.has(entry.inboxId))
      .filter((entry) => params.prepared?.() !== false || entry.kind === INBOX_KIND_MESSAGE)
      .flatMap((entry) => params.postedDraftsOf(entry))
    if (drafts.length === 0) return
    await params.appendDrafts(drafts)
  } catch (error) {
    params.log?.error({
      source: 'holder.intake',
      message: 'logging the staged inputs failed',
      ...logFieldsOf({ error }),
    })
  }
}
