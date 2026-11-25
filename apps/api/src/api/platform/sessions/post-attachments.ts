import {
  attachmentsOf,
  EAttachmentStore,
  uploadsOf,
  type Attachment,
  type SaidUpload,
} from '@dltech/atlas-core'
import type { MediaStore } from '@dltech/atlas-media'
import type { SessionPostMedia } from '@dltech/atlas-protocol'
import { attachedMedia } from './media-attachments'
import type { MediaRegistry } from './media-registry'
import { attachedUploads } from './upload-attachments'

type Posted = {
  media?: readonly SessionPostMedia[] | undefined
  uploads?: readonly SaidUpload[] | undefined
  attachments?: readonly Attachment[] | undefined
}

const withoutInline = (attachment: Attachment): Attachment => {
  const { content } = attachment
  if (content.store === EAttachmentStore.Inline) return attachment
  const { inline: _inline, ...rest } = content
  return { ...attachment, content: rest }
}

async function verifiedAttachments(args: {
  registry: MediaRegistry
  store: MediaStore
  userId: string
  attachments: readonly Attachment[]
}): Promise<Attachment[]> {
  const { attachments } = args
  const uploads = await attachedUploads({
    store: args.store,
    userId: args.userId,
    uploads: uploadsOf(attachments),
  })
  const refs = await attachedMedia({
    registry: args.registry,
    userId: args.userId,
    media: attachments.flatMap((attachment) =>
      attachment.content.store === EAttachmentStore.Media
        ? [
            {
              hash: attachment.content.hash,
              source: attachment.source ?? attachment.name,
            },
          ]
        : [],
    ),
  })
  const sizes = new Map(uploads.map((upload) => [upload.uploadId, upload.size]))
  const media = new Map(refs.map((entry) => [entry.media.hash, entry.media]))
  return attachments.map((attachment) => {
    const { content } = attachment
    const clean = withoutInline(attachment)
    if (content.store === EAttachmentStore.Upload) {
      return { ...clean, size: sizes.get(content.uploadId) ?? attachment.size }
    }
    const ref = content.store === EAttachmentStore.Media ? media.get(content.hash) : undefined
    if (ref === undefined) return clean
    return {
      ...clean,
      mediaType: ref.mediaType,
      size: ref.size,
      image: { width: ref.width, height: ref.height },
    }
  })
}

export async function postedAttachmentsOf(
  args: Posted & { registry: MediaRegistry; store: MediaStore; userId: string },
): Promise<readonly Attachment[]> {
  if (args.attachments !== undefined && args.attachments.length > 0) {
    return verifiedAttachments({ ...args, attachments: args.attachments })
  }
  const media = await attachedMedia({
    registry: args.registry,
    userId: args.userId,
    media: args.media ?? [],
  })
  const uploads = await attachedUploads({
    store: args.store,
    userId: args.userId,
    uploads: args.uploads ?? [],
  })
  return attachmentsOf({ media, uploads })
}
