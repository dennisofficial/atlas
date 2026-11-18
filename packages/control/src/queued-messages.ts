import {
  commandInputName,
  pendingMessagesOf,
  type PendingInput,
  type PendingInputsState,
} from '@dltech/atlas-core'
import {
  ECommandState,
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

export const commandsOf = (state: PendingInputsState): SessionCommandRow[] =>
  state.pending
    .flatMap((entry) => {
      const name = commandInputName(entry.kind)
      if (name === undefined) return []
      return [{ inboxId: entry.inboxId, name, postedAt: entry.at, state: ECommandState.Queued }]
    })
    .slice(0, QUEUED_MESSAGES_LIMIT)
