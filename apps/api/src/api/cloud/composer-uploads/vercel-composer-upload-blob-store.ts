import { BlobNotFoundError, del, head, issueSignedToken, list, presignUrl } from '@vercel/blob'
import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { ComposerUploadBlobStore } from './composer-upload-blob-store'

const UPLOAD_TTL_MS = 15 * 60 * 1000
const DOWNLOAD_TTL_MS = 15 * 60 * 1000

@Injectable()
export class VercelComposerUploadBlobStore extends ComposerUploadBlobStore {
  constructor(private readonly env: EnvService) {
    super()
  }

  async presignUpload(args: {
    pathname: string
    maximumSizeInBytes: number
  }): Promise<{ uploadUrl: string; validUntil: number }> {
    const validUntil = Date.now() + UPLOAD_TTL_MS
    const constraints = { maximumSizeInBytes: args.maximumSizeInBytes }
    const signed = await issueSignedToken({
      token: this.token(),
      pathname: args.pathname,
      operations: ['put'],
      validUntil,
      ...constraints,
    })
    const { presignedUrl } = await presignUrl(signed, {
      operation: 'put',
      pathname: args.pathname,
      access: 'private',
      validUntil,
      addRandomSuffix: false,
      allowOverwrite: false,
      ...constraints,
    })
    return { uploadUrl: presignedUrl, validUntil }
  }

  async head(args: { pathname: string }): Promise<{ size: number } | null> {
    try {
      const found = await head(args.pathname, { token: this.token() })
      return { size: found.size }
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null
      throw error
    }
  }

  async presignDownload(args: { pathname: string }): Promise<{ downloadUrl: string }> {
    const validUntil = Date.now() + DOWNLOAD_TTL_MS
    const signed = await issueSignedToken({
      token: this.token(),
      pathname: args.pathname,
      operations: ['get'],
      validUntil,
    })
    const { presignedUrl } = await presignUrl(signed, {
      operation: 'get',
      pathname: args.pathname,
      access: 'private',
      validUntil,
    })
    return { downloadUrl: presignedUrl }
  }

  async delete(args: { pathnames: string[] }): Promise<void> {
    if (args.pathnames.length === 0) return
    await del(args.pathnames, { token: this.token() })
  }

  async listOlderThan(args: { prefix: string; before: Date }): Promise<string[]> {
    const token = this.token()
    const old: string[] = []
    let cursor: string | undefined
    do {
      const page = await list({
        prefix: args.prefix,
        token,
        ...(cursor === undefined ? {} : { cursor }),
      })
      for (const blob of page.blobs) {
        if (blob.uploadedAt < args.before) old.push(blob.pathname)
      }
      cursor = page.hasMore ? page.cursor : undefined
    } while (cursor !== undefined)
    return old
  }

  private token(): string {
    const token = this.env.get('BLOB_READ_WRITE_TOKEN')
    if (!token) throw new ServiceUnavailableException('upload storage is not configured')
    return token
  }
}
