import { randomUUID } from 'node:crypto'
import { BadRequestException, Injectable, PayloadTooLargeException } from '@nestjs/common'
import {
  COMPOSER_UPLOADS_PREFIX,
  MAX_UPLOAD_BYTES,
  safeUploadName,
  type ComposerUploadDownloadReply,
  type ComposerUploadPresignReply,
} from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { ownedThread } from '../../platform/sessions/ownership'
import { ComposerUploadBlobStore } from './composer-upload-blob-store'

const prefixOf = (userId: string): string => `${COMPOSER_UPLOADS_PREFIX}${userId}/`

function assertOwnPathname(args: { userId: string; pathname: string }): void {
  if (!args.pathname.startsWith(prefixOf(args.userId))) {
    throw new BadRequestException('pathname does not belong to this account')
  }
}

@Injectable()
export class ComposerUploadsService {
  constructor(private readonly blobs: ComposerUploadBlobStore) {}

  async presign(args: {
    userId: string
    name: string
    size: number
    mediaType: string
  }): Promise<ComposerUploadPresignReply> {
    if (args.size > MAX_UPLOAD_BYTES) throw new PayloadTooLargeException('file is too large')
    const uploadId = randomUUID()
    const name = safeUploadName(args.name)
    const pathname = `${prefixOf(args.userId)}${uploadId}/${name}`
    const { uploadUrl, validUntil } = await this.blobs.presignUpload({
      pathname,
      maximumSizeInBytes: MAX_UPLOAD_BYTES,
    })
    return {
      upload: {
        uploadId,
        pathname,
        name,
        size: args.size,
        mediaType: args.mediaType,
      },
      uploadUrl,
      validUntil,
    }
  }

  async discard(args: { userId: string; pathname: string }): Promise<void> {
    assertOwnPathname(args)
    await this.blobs.delete({ pathnames: [args.pathname] })
  }

  async download(args: {
    userId: string
    threadId: string
    pathname: string
  }): Promise<ComposerUploadDownloadReply> {
    await ownedThread({
      reader: db,
      userId: args.userId,
      threadId: args.threadId,
    })
    assertOwnPathname(args)
    const blob = await this.blobs.head({ pathname: args.pathname })
    if (blob === null) return { found: false }
    const { downloadUrl } = await this.blobs.presignDownload({
      pathname: args.pathname,
    })
    return { found: true, downloadUrl, size: blob.size }
  }
}
