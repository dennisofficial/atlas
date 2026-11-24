import {
  commandInputName,
  pendingMessagesOf,
  type InboxEntry,
  type PendingInput,
  type PendingInputsState,
} from '@dltech/atlas-core'
import {
  ECommandState,
  INBOX_KIND_MESSAGE,
  inboxMessageSchema,
  QUEUED_MESSAGES_LIMIT,
  type SessionCommandRow,
  type SessionQueuedMessage,
} from '@dltech/atlas-protocol'

const attachmentsOf = (entry: PendingInput): Pick<SessionQueuedMessage, 'attachments'> => {
  const attachments = entry.message?.attachments
  return attachments === undefined || attachments.length === 0
    ? {}
    : { attachments: [...attachments] }
}

export const queuedOf = (state: PendingInputsState): SessionQueuedMessage[] =>
  pendingMessagesOf(state)
    .flatMap((entry) => {
      const message = entry.message
      if (message === undefined) return []
      return [
        {
          inboxId: entry.inboxId,
          text: message.text,
          postedAt: entry.at,
          ...attachmentsOf(entry),
          ...(message.clientId === undefined ? {} : { clientId: message.clientId }),
        },
      ]
    })
    .slice(0, QUEUED_MESSAGES_LIMIT)

const messageOfPayload = (payload: string) => {
  try {
    const parsed = inboxMessageSchema.safeParse(JSON.parse(payload))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export const queuedFromInboxOf = (entries: readonly InboxEntry[]): SessionQueuedMessage[] =>
  entries.flatMap((entry) => {
    if (entry.consumedSeq !== null || entry.kind !== INBOX_KIND_MESSAGE) return []
    const message = messageOfPayload(entry.payload)
    if (message === undefined) return []
    return [
      {
        inboxId: entry.inboxId,
        text: message.text,
        postedAt: entry.postedAt,
        ...(message.attachments === undefined || message.attachments.length === 0
          ? {}
          : { attachments: [...message.attachments] }),
        ...(message.media === undefined ? {} : { media: [...message.media] }),
        ...(message.uploads === undefined ? {} : { uploads: [...message.uploads] }),
        ...(message.clientId === undefined ? {} : { clientId: message.clientId }),
      },
    ]
  })

export const queuedRowsOf = (args: {
  pending: PendingInputsState
  inbox: readonly InboxEntry[]
}): SessionQueuedMessage[] => {
  const logged = queuedOf(args.pending)
  const unlogged = queuedFromInboxOf(args.inbox).filter(
    (row) => !logged.some((kept) => kept.inboxId === row.inboxId),
  )
  return [...logged, ...unlogged].slice(0, QUEUED_MESSAGES_LIMIT)
}

export const commandsOf = (state: PendingInputsState): SessionCommandRow[] =>
  state.pending
    .flatMap((entry) => {
      const name = commandInputName(entry.kind)
      if (name === undefined) return []
      return [{ inboxId: entry.inboxId, name, postedAt: entry.at, state: ECommandState.Queued }]
    })
    .slice(0, QUEUED_MESSAGES_LIMIT)
