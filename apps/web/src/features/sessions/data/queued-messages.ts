import { EAttachmentStore, type Attachment } from '@dltech/atlas-core'
import {
  EQueuedAttachmentKind,
  type QueuedAttachment,
  type QueuedMessageEntry,
} from '@dltech/atlas-ui/ai/queued-messages'
import type { SessionQueuedMessage } from '@dltech/atlas-protocol'

const NO_URLS: ReadonlyMap<string, string> = new Map()

const storedHashOf = (attachment: Attachment): string | undefined =>
  attachment.content.store === EAttachmentStore.Media ? attachment.content.hash : undefined

export const queuedMediaHashesOf = (
  queued: readonly SessionQueuedMessage[] | undefined,
): string[] => [
  ...new Set(
    (queued ?? []).flatMap((message) => [
      ...(message.media ?? []).map((item) => item.media.hash),
      ...(message.attachments ?? []).flatMap((attachment) => {
        const hash = storedHashOf(attachment)
        return hash === undefined ? [] : [hash]
      }),
    ]),
  ),
]

const storedAttachmentsOf = (args: {
  message: SessionQueuedMessage
  urls: ReadonlyMap<string, string>
}): QueuedAttachment[] =>
  (args.message.attachments ?? []).map((attachment) => {
    const hash = storedHashOf(attachment)
    const previewUrl = hash === undefined ? undefined : args.urls.get(hash)
    return {
      id: attachment.id,
      name: attachment.name,
      kind: attachment.mediaType.startsWith('image/')
        ? EQueuedAttachmentKind.Image
        : EQueuedAttachmentKind.File,
      size: attachment.size,
      ...(previewUrl === undefined ? {} : { previewUrl }),
    }
  })

const queuedAttachmentsOf = (args: {
  message: SessionQueuedMessage
  urls: ReadonlyMap<string, string>
}): QueuedAttachment[] => [
  ...storedAttachmentsOf(args),
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
  urls?: ReadonlyMap<string, string> | undefined
}): QueuedMessageEntry[] => {
  const urls = args.urls ?? NO_URLS
  return (args.queued ?? []).map((message) => ({
    id: String(message.inboxId),
    text: message.text,
    attachments: queuedAttachmentsOf({ message, urls }),
  }))
}

export const mergeWithdrawnIntoDraft = (args: { withdrawn: string; draft: string }): string =>
  args.draft.trim().length === 0 ? args.withdrawn : `${args.withdrawn}\n\n${args.draft}`
