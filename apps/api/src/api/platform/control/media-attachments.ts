import { BadRequestException } from '@nestjs/common'
import { mediaPathname, type MediaRef, type SaidImage } from '@dltech/atlas-core'
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
  media: readonly AttachedMedia[]
}): Promise<SaidImage[]> {
  const loaded = await Promise.all(
    args.media.map(async ({ media, source }): Promise<SaidImage[]> => {
      const pathname = mediaPathname({ userId: args.userId, hash: media.hash })
      const bytes = await args.store.read({ pathname }).catch(() => null)
      if (bytes === null) return []
      return [
        {
          path: source ?? media.hash,
          mediaType: media.mediaType,
          data: Buffer.from(bytes).toString('base64'),
          width: media.width,
          height: media.height,
        },
      ]
    }),
  )
  return loaded.flat()
}
