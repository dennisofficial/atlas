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

const attachmentsOf = (entry: PendingInput): Pick<SessionQueuedMessage, 'attachments'> =>
  entry.attachments === undefined || entry.attachments.length === 0
    ? {}
    : { attachments: [...entry.attachments] }

export const queuedOf = (state: PendingInputsState): SessionQueuedMessage[] =>
  pendingMessagesOf(state)
    .flatMap((entry) =>
      entry.text === undefined
        ? []
        : [
            {
              inboxId: entry.inboxId,
              text: entry.text,
              postedAt: entry.at,
              ...attachmentsOf(entry),
              ...(entry.clientId === undefined ? {} : { clientId: entry.clientId }),
            },
          ],
    )
    .slice(0, QUEUED_MESSAGES_LIMIT)

export const commandsOf = (state: PendingInputsState): SessionCommandRow[] =>
  state.pending
    .flatMap((entry) => {
      const name = commandInputName(entry.kind)
      if (name === undefined) return []
      return [{ inboxId: entry.inboxId, name, postedAt: entry.at, state: ECommandState.Queued }]
    })
    .slice(0, QUEUED_MESSAGES_LIMIT)
