import { BadRequestException } from '@nestjs/common'
import {
  inlineData,
  isImage,
  mediaHashOf,
  mediaPathname,
  type Attachment,
  type MediaRef,
  type SaidImage,
} from '@dltech/atlas-core'
import type { MediaStore } from '@dltech/atlas-media'
import type { SessionPostMedia } from '@dltech/atlas-protocol'
import type { MediaRegistry } from './media-registry'

export type AttachedMedia = { media: MediaRef; source?: string }

export async function attachedMedia(args: {
  registry: MediaRegistry
  userId: string
  media: readonly SessionPostMedia[]
}): Promise<AttachedMedia[]> {
  if (args.media.length === 0) return []
  const found = await args.registry.findMany({
    userId: args.userId,
    hashes: args.media.map((entry) => entry.hash),
  })
  const byHash = new Map(found.map((ref) => [ref.hash, ref]))
  return args.media.map((entry) => {
    const ref = byHash.get(entry.hash)
    if (ref === undefined) throw new BadRequestException(`image ${entry.hash} was not uploaded`)
    return {
      media: ref,
      ...(entry.source === undefined ? {} : { source: entry.source }),
    }
  })
}

export async function imagesForNaming(args: {
  store: MediaStore
  userId: string
  attachments: readonly Attachment[]
}): Promise<SaidImage[]> {
  const loaded = await Promise.all(
    args.attachments.map(async (attachment): Promise<SaidImage[]> => {
      if (!isImage(attachment)) return []
      const bytes = await namingBytesOf({
        store: args.store,
        userId: args.userId,
        attachment,
      })
      if (bytes === null) return []
      return [
        {
          path: attachment.source ?? attachment.name,
          mediaType: attachment.mediaType,
          data: bytes,
          width: attachment.image?.width,
          height: attachment.image?.height,
        },
      ]
    }),
  )
  return loaded.flat()
}

async function namingBytesOf(args: {
  store: MediaStore
  userId: string
  attachment: Attachment
}): Promise<string | null> {
  const inline = inlineData(args.attachment)
  if (inline !== undefined) return inline
  const hash = mediaHashOf(args.attachment)
  if (hash === null) return null
  const bytes = await args.store
    .read({ pathname: mediaPathname({ userId: args.userId, hash }) })
    .catch(() => null)
  return bytes === null ? null : Buffer.from(bytes).toString('base64')
}
