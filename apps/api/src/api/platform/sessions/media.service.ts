import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { MAX_INLINE_BYTES, mediaPathname, type MediaRef } from '@dltech/atlas-core'
import { MediaStore } from '@dltech/atlas-media'
import type { MediaConfirmOutput, MediaPresignOutput, MediaUrlOutput } from '@dltech/atlas-protocol'
import { MediaRegistry } from './media-registry'
import { validateMediaBytes } from './media-validation'
import { SessionsService } from './sessions.service'

export const UPLOAD_TTL_MS = 15 * 60 * 1000
export const READ_TTL_MS = 60 * 60 * 1000

@Injectable()
export class MediaService {
  constructor(
    @Inject(MediaStore) private readonly store: MediaStore,
    @Inject(MediaRegistry) private readonly registry: MediaRegistry,
    @Inject(SessionsService) private readonly sessions: SessionsService,
  ) {}

  async presign(args: {
    userId: string
    hash: string
    size: number
    mediaType: string
  }): Promise<MediaPresignOutput> {
    const existing = await this.registry.find(args)
    if (existing !== undefined) return { exists: true, media: existing }
    const validUntil = Date.now() + UPLOAD_TTL_MS
    const uploadUrl = await this.store.presignPut({
      pathname: mediaPathname(args),
      maximumSizeInBytes: MAX_INLINE_BYTES,
      validUntil,
    })
    return { exists: false, uploadUrl, validUntil }
  }

  async confirm(args: { userId: string; hash: string }): Promise<MediaConfirmOutput> {
    const existing = await this.registry.find(args)
    if (existing !== undefined) return { media: existing }
    const pathname = mediaPathname(args)
    const bytes = await this.store.read({ pathname })
    if (bytes === null) throw new NotFoundException('image was not uploaded')
    const checked = validateMediaBytes({ hash: args.hash, bytes })
    if (!checked.ok) {
      await this.store.delete({ pathnames: [pathname] })
      throw new BadRequestException(checked.reason)
    }
    await this.registry.insertIfAbsent({
      userId: args.userId,
      media: checked.media,
    })
    const stored = await this.registry.find(args)
    return { media: stored ?? checked.media }
  }

  async url(args: { userId: string; sessionId: string; hash: string }): Promise<MediaUrlOutput> {
    await this.sessions.requireOwnedSession(args)
    const media = await this.registry.find(args)
    if (media === undefined) throw new NotFoundException('image not found')
    const validUntil = Date.now() + READ_TTL_MS
    const delegation = await this.store.issueReadDelegation({ validUntil })
    const url = await this.store.presignGet({
      delegation,
      pathname: mediaPathname(args),
      validUntil,
    })
    return { url }
  }

  async refsOf(args: {
    userId: string
    hashes: readonly string[]
  }): Promise<Map<string, MediaRef>> {
    const found = await this.registry.findMany(args)
    return new Map(found.map((media) => [media.hash, media]))
  }
}
