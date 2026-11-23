'use client'

import { UserMessage, type MessageAttachment } from '@dltech/atlas-ui/ai/message'
import type { QueuedMessageEntry } from '@dltech/atlas-ui/ai/queued-messages'

import { TranscriptMarkdown } from './transcript-markdown'

const attachmentsOf = (entry: QueuedMessageEntry): MessageAttachment[] =>
  entry.attachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    ...(attachment.previewUrl === undefined ? {} : { src: attachment.previewUrl }),
  }))

export function PendingUserMessage({
  entry,
  author,
  label,
  actionsDisabled,
  onEdit,
  onRemove,
}: {
  entry: QueuedMessageEntry
  author: string | undefined
  label: string
  actionsDisabled?: boolean | undefined
  onEdit?: () => void
  onRemove?: () => void
}) {
  return (
    <UserMessage
      author={author}
      timestamp={label}
      attachments={attachmentsOf(entry)}
      {...(actionsDisabled === undefined ? {} : { actionsDisabled })}
      {...(onEdit === undefined ? {} : { onEdit })}
      {...(onRemove === undefined ? {} : { onRemove })}
    >
      {entry.text.trim().length === 0 ? undefined : (
        <TranscriptMarkdown breaks>{entry.text}</TranscriptMarkdown>
      )}
    </UserMessage>
  )
}
