import { z } from 'zod'

import {
  attachmentSchema,
  attachmentsOf,
  EMessageOrigin,
  INBOX_KIND_EVENT,
  INBOX_KIND_RECORD,
  inboxEventOf,
  INBOX_KIND_RETRY,
  INBOX_KIND_STOP,
  pendingInputsOf,
  pendingNoticesOf,
  pendingRecordsOf,
  userSaidOf,
  type EventBody,
  type EventDraft,
  type InboxEntry,
  type InputMessage,
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

export const jsonOf = (payload: string): unknown => {
  try {
    return JSON.parse(payload)
  } catch {
    return undefined
  }
}

export const inputMessageOf = (params: {
  entry: InboxEntry
  message: InboxMessage
}): InputMessage => {
  const attachments = attachmentsOf(params.message)
  const sender = params.entry.senderSessionId
  const origin = sender === null ? params.message.via : EMessageOrigin.PeerAgent
  return {
    text: params.message.text,
    ...(attachments.length === 0 ? {} : { attachments }),
    ...(params.message.clientId === undefined ? {} : { clientId: params.message.clientId }),
    ...(origin === undefined ? {} : { via: origin }),
    ...(sender === null ? {} : { sender: { session: sender } }),
  }
}

export const salvagedOf = (
  payload: string,
): {
  message?: InputMessage | undefined
  clientId?: string | undefined
} => {
  const raw = jsonOf(payload)
  if (typeof raw !== 'object' || raw === null) return {}
  const record = raw as Record<string, unknown>
  const text = typeof record.text === 'string' ? record.text : undefined
  const clientId =
    typeof record.clientId === 'string' && record.clientId.length > 0 ? record.clientId : undefined
  const attachments = z.array(attachmentSchema).safeParse(record.attachments)
  const kept = attachments.success && attachments.data.length > 0 ? attachments.data : undefined
  return {
    ...(text === undefined
      ? {}
      : { message: { text, ...(kept === undefined ? {} : { attachments: kept }) } }),
    ...(clientId === undefined ? {} : { clientId }),
  }
}

export const postedDraftOf = (params: {
  entry: InboxEntry
  message: InputMessage
}): RecordBody => ({
  type: 'input-posted',
  inboxId: params.entry.inboxId,
  kind: params.entry.kind,
  postedAt: params.entry.postedAt,
  message: params.message,
})

export const postedAndSaidOf = (params: {
  entry: InboxEntry
  message: InputMessage
}): (RecordBody | EventDraft)[] => [
  postedDraftOf(params),
  userSaidOf({ inboxId: params.entry.inboxId, message: params.message }),
]

export const postedDraftsOf = (params: {
  entry: InboxEntry
  resolveCommand: (entry: InboxEntry) => ResolvedCommand
}): RecordBody[] => {
  const { entry } = params
  if (entry.kind === INBOX_KIND_STOP || entry.kind === INBOX_KIND_RETRY) return []
  if (entry.kind === INBOX_KIND_EVENT || entry.kind === INBOX_KIND_RECORD) {
    const read = inboxEventOf(entry.payload)
    if (!read.ok) return []
    return [
      {
        type: 'input-posted',
        inboxId: entry.inboxId,
        kind: entry.kind,
        postedAt: entry.postedAt,
        event: read.event,
      },
    ]
  }
  if (entry.kind === INBOX_KIND_WITHDRAW) return []
  if (entry.kind === INBOX_KIND_MESSAGE) {
    const parsed = inboxMessageSchema.safeParse(jsonOf(entry.payload))
    if (!parsed.success) return []
    return [postedDraftOf({ entry, message: inputMessageOf({ entry, message: parsed.data }) })]
  }
  if (isCommandKind(entry.kind) && params.resolveCommand(entry) === undefined) return []
  return [
    {
      type: 'input-posted',
      inboxId: entry.inboxId,
      kind: entry.kind,
      postedAt: entry.postedAt,
    },
  ]
}

export const postedInboxIdsOf = (params: { events: readonly V2Event[] }): ReadonlySet<number> => {
  const pending = pendingInputsOf(params.events).pending
  return new Set(pending.map((entry) => entry.inboxId))
}

export type Drainable = {
  entry?: InboxEntry | undefined
  inboxId: number
  message: InputMessage
  posted: boolean
}

export type LoggedMessage = { inboxId: number; message: InputMessage }

export const drainOrderOf = (params: {
  staged: readonly { entry: InboxEntry; message: InputMessage }[]
  logged: readonly LoggedMessage[]
  posted: ReadonlySet<number>
}): Drainable[] => {
  const known = new Set(params.staged.map((item) => item.entry.inboxId))
  const logged = params.logged.flatMap((item) =>
    known.has(item.inboxId) ? [] : [{ ...item, posted: true }],
  )
  const staged = params.staged.map((item) => ({
    entry: item.entry,
    inboxId: item.entry.inboxId,
    message: item.message,
    posted: params.posted.has(item.entry.inboxId),
  }))
  return [...staged, ...logged].sort((left, right) => left.inboxId - right.inboxId)
}

export const loggedMessagesOf = (events: readonly V2Event[]): LoggedMessage[] =>
  pendingInputsOf(events).pending.flatMap((pending) =>
    pending.kind !== INBOX_KIND_MESSAGE || pending.message === undefined
      ? []
      : [{ inboxId: pending.inboxId, message: pending.message }],
  )

export const loggedNoticesOf = (params: {
  events: readonly V2Event[]
  staged: ReadonlySet<number>
}): { inboxId: number; event: EventBody; record: boolean }[] => {
  const pending = pendingInputsOf(params.events)
  return [...pendingNoticesOf(pending), ...pendingRecordsOf(pending)].flatMap((pending) =>
    pending.event === undefined || params.staged.has(pending.inboxId)
      ? []
      : [
          {
            inboxId: pending.inboxId,
            event: pending.event,
            record: pending.kind === INBOX_KIND_RECORD,
          },
        ],
  )
}

export const stagesUnprepared = (kind: string): boolean =>
  kind === INBOX_KIND_MESSAGE || kind === INBOX_KIND_EVENT

export const logStagedInputs = async (params: {
  fetch: () => Promise<InboxEntry[]>
  resolveWithdraws: (entries: readonly InboxEntry[]) => Promise<ReadonlySet<number>>
  skips?: ((entry: InboxEntry) => boolean) | undefined
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
      .filter((entry) => params.skips?.(entry) !== true)
      .filter((entry) => !resolved.has(entry.inboxId))
      .filter((entry) => params.prepared?.() !== false || stagesUnprepared(entry.kind))
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
