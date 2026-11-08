import { COMMAND_INBOX_PREFIX } from '@dltech/atlas-commands'
import type { InboxEntry } from '@dltech/atlas-core'
import {
  INBOX_KIND_MESSAGE,
  inboxMessageSchema,
  QUEUED_MESSAGES_LIMIT,
  type InboxMessage,
  ECommandState,
  type SessionCommandRow,
  type SessionQueuedMessage,
} from '@dltech/atlas-protocol'

const attachmentsOf = (message: InboxMessage): Pick<SessionQueuedMessage, 'media' | 'uploads'> => ({
  ...(message.media === undefined || message.media.length === 0 ? {} : { media: message.media }),
  ...(message.uploads === undefined || message.uploads.length === 0
    ? {}
    : { uploads: message.uploads }),
})

export const queuedOf = (inbox: readonly InboxEntry[]): SessionQueuedMessage[] =>
  inbox
    .filter((entry) => entry.kind === INBOX_KIND_MESSAGE)
    .flatMap((entry) => {
      const parsed = inboxMessageSchema.safeParse(safeJson(entry.payload))
      if (!parsed.success) return []
      return [
        {
          inboxId: entry.inboxId,
          text: parsed.data.text,
          postedAt: entry.postedAt,
          ...attachmentsOf(parsed.data),
        },
      ]
    })
    .slice(0, QUEUED_MESSAGES_LIMIT)

export const commandsOf = (inbox: readonly InboxEntry[]): SessionCommandRow[] =>
  inbox
    .filter((entry) => entry.kind.startsWith(COMMAND_INBOX_PREFIX))
    .map((entry) => ({
      inboxId: entry.inboxId,
      name: entry.kind.slice(COMMAND_INBOX_PREFIX.length),
      postedAt: entry.postedAt,
      state: ECommandState.Queued,
    }))
    .slice(0, QUEUED_MESSAGES_LIMIT)

const safeJson = (payload: string): unknown => {
  try {
    return JSON.parse(payload)
  } catch {
    return undefined
  }
}
