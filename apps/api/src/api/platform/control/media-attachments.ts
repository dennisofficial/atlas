import { BadRequestException } from '@nestjs/common'
import type { MediaRef } from '@dltech/atlas-core'
import type { SessionPostMedia } from '@dltech/atlas-protocol'
import type { MediaRegistry } from './media-registry'

export async function attachedMedia(args: {
  registry: MediaRegistry
  userId: string
  media: readonly SessionPostMedia[]
}): Promise<{ media: MediaRef; source?: string }[]> {
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
