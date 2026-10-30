import { EQueuedAttachmentKind, type QueuedMessageEntry } from '@dltech/atlas-ui/ai/queued-messages'
import { EMessageOrigin } from '@dltech/atlas-core'
import type { PendingEntryWire } from '@dltech/atlas-wire/web'

export const TOO_LATE_NOTICE = 'Atlas already started on that message.'
export const QUEUE_PLACEHOLDER = 'Queue a message for when Atlas is done…'

const isTakeBackable = (entry: PendingEntryWire): boolean =>
  !entry.reserved && (entry.via === undefined || entry.via === EMessageOrigin.Operator)

export const takeBackableIdOf = (pending: readonly PendingEntryWire[]): string | null =>
  pending.findLast(isTakeBackable)?.id ?? null

export const queuedOf = (pending: readonly PendingEntryWire[]): QueuedMessageEntry[] =>
  pending.map((entry) => ({
    id: entry.id,
    text: entry.text,
    attachments: (entry.uploads ?? []).map((upload) => ({
      id: upload.uploadId,
      name: upload.name,
      kind: upload.mediaType.startsWith('image/')
        ? EQueuedAttachmentKind.Image
        : EQueuedAttachmentKind.File,
      size: upload.size,
    })),
  }))
