import {
  EQueuedAttachmentKind,
  type QueuedAttachment,
  type QueuedMessageEntry,
} from '@dltech/atlas-ui/ai/queued-messages'
import type { SessionQueuedMessage } from '@dltech/atlas-protocol'
import type { V2Event } from '@dltech/atlas-core'

const INBOX_REQUEST_PREFIX = 'inbox:'
const NO_URLS: ReadonlyMap<string, string> = new Map()

export const consumedInboxIdsOf = (events: readonly V2Event[]): ReadonlySet<number> => {
  const ids = new Set<number>()
  for (const event of events) {
    if (event.type !== 'user-said' || event.requestId === undefined) continue
    if (!event.requestId.startsWith(INBOX_REQUEST_PREFIX)) continue
    const id = Number(event.requestId.slice(INBOX_REQUEST_PREFIX.length))
    if (Number.isInteger(id)) ids.add(id)
  }
  return ids
}

export const queuedMediaHashesOf = (
  queued: readonly SessionQueuedMessage[] | undefined,
): string[] => [
  ...new Set(
    (queued ?? []).flatMap((message) => (message.media ?? []).map((item) => item.media.hash)),
  ),
]

const queuedAttachmentsOf = (args: {
  message: SessionQueuedMessage
  urls: ReadonlyMap<string, string>
}): QueuedAttachment[] => [
  ...(args.message.media ?? []).map((item, index) => {
    const previewUrl = args.urls.get(item.media.hash)
    return {
      id: `media-${index}-${item.media.hash}`,
      name: item.source ?? 'image',
      kind: EQueuedAttachmentKind.Image,
      size: item.media.size,
      ...(previewUrl === undefined ? {} : { previewUrl }),
    }
  }),
  ...(args.message.uploads ?? []).map((upload) => ({
    id: upload.uploadId,
    name: upload.name,
    kind: EQueuedAttachmentKind.File,
    size: upload.size,
  })),
]

export const visibleQueuedOf = (args: {
  queued: readonly SessionQueuedMessage[] | undefined
  events: readonly V2Event[]
  urls?: ReadonlyMap<string, string> | undefined
}): QueuedMessageEntry[] => {
  const consumed = consumedInboxIdsOf(args.events)
  const urls = args.urls ?? NO_URLS
  return (args.queued ?? [])
    .filter((message) => !consumed.has(message.inboxId))
    .map((message) => ({
      id: String(message.inboxId),
      text: message.text,
      attachments: queuedAttachmentsOf({ message, urls }),
    }))
}

export const mergeWithdrawnIntoDraft = (args: { withdrawn: string; draft: string }): string =>
  args.draft.trim().length === 0 ? args.withdrawn : `${args.withdrawn}\n\n${args.draft}`
