import {
  pendingMessagesOf,
  pendingNoticesOf,
  type Attachment,
  type PendingInputsState,
} from '@dltech/atlas-core'

import { queuedNoticeLineOf } from '../transcript/queued-notice-line'

export type QueuedMessage = { id: string; text: string; attachments: readonly Attachment[] }

export type QueuedNoticeEntry = { id: string; text: string; failed: boolean }

export const queuedMessagesOf = (pending: PendingInputsState): QueuedMessage[] =>
  pendingMessagesOf(pending).map((input) => ({
    id: String(input.inboxId),
    text: input.message?.text ?? '',
    attachments: input.message?.attachments ?? [],
  }))

export const queuedNoticesOf = (pending: PendingInputsState): QueuedNoticeEntry[] =>
  pendingNoticesOf(pending).flatMap((input) => {
    const line = input.event === undefined ? undefined : queuedNoticeLineOf(input.event)
    return line === undefined ? [] : [{ id: String(input.inboxId), ...line }]
  })

export const stagedQueuedMessagesOf = (
  staged: readonly {
    clientId: string
    text: string
    attachments?: readonly Attachment[] | undefined
  }[],
): QueuedMessage[] =>
  staged.map((input) => ({
    id: input.clientId,
    text: input.text,
    attachments: input.attachments ?? [],
  }))
