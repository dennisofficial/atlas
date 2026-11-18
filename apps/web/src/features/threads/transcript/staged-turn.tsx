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

export function StagedTurn({
  entry,
  author,
}: {
  entry: QueuedMessageEntry
  author: string | undefined
}) {
  return (
    <div aria-busy="true" className="opacity-45 transition-opacity">
      <UserMessage author={author} attachments={attachmentsOf(entry)}>
        {entry.text.trim().length === 0 ? undefined : (
          <TranscriptMarkdown breaks>{entry.text}</TranscriptMarkdown>
        )}
      </UserMessage>
    </div>
  )
}
