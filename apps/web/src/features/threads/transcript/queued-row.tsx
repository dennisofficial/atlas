'use client'

import { EQueuedRowKind, type QueuedRow } from '@/features/sessions/data/queued-transcript'

import { ReportNotice } from './transcript-agents'
import { TranscriptNotice } from './transcript-notice'
import { PendingUserMessage } from './pending-user-message'

const DIM = 'opacity-45 transition-opacity hover:opacity-100 focus-within:opacity-100'

export function QueuedRowItem({
  row,
  author,
  onOpenAgent,
  onEdit,
  onRemove,
}: {
  row: QueuedRow
  author: string | undefined
  onOpenAgent: ((id: string) => void) | null
  onEdit: (inboxId: string) => void
  onRemove: (inboxId: string) => void
}) {
  return (
    <section aria-label="Queued" data-queued={row.kind} className={DIM}>
      {row.kind === EQueuedRowKind.Message ? (
        <PendingUserMessage
          entry={row.entry}
          author={author}
          label="Queued"
          actionsDisabled={row.optimistic === true}
          onEdit={() => onEdit(row.entry.id)}
          onRemove={() => onRemove(row.entry.id)}
        />
      ) : row.kind === EQueuedRowKind.Report ? (
        <ReportNotice item={row.item} onOpenAgent={onOpenAgent} />
      ) : (
        <TranscriptNotice item={row.item} />
      )}
    </section>
  )
}
