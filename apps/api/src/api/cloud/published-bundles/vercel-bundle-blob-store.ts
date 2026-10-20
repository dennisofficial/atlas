import { BlobNotFoundError, head, issueSignedToken, presignUrl } from '@vercel/blob'
import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { PUBLISHED_BUNDLE_CONTENT_TYPE, PUBLISHED_BUNDLE_MAX_BYTES } from '@dltech/atlas-wire'
import { EnvService } from '../../../_core/config/env/env.service'
import { BundleBlobStore, type BlobHead, type PresignedUpload } from './blob-store'

const UPLOAD_TTL_MS = 15 * 60 * 1000
const DOWNLOAD_TTL_MS = 60 * 60 * 1000

@Injectable()
export class VercelBundleBlobStore extends BundleBlobStore {
  constructor(private readonly env: EnvService) {
    super()
  }

  async presignUpload(args: { pathname: string }): Promise<PresignedUpload> {
    const token = this.token()
    const validUntil = Date.now() + UPLOAD_TTL_MS
    const constraints = {
      allowedContentTypes: [PUBLISHED_BUNDLE_CONTENT_TYPE],
      maximumSizeInBytes: PUBLISHED_BUNDLE_MAX_BYTES,
    }
    const signed = await issueSignedToken({
      token,
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

  async head(args: { pathname: string }): Promise<BlobHead | null> {
    try {
      const found = await head(args.pathname, { token: this.token() })
      return { url: found.url, size: found.size }
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

  private token(): string {
    const token = this.env.get('BLOB_READ_WRITE_TOKEN')
    if (!token) throw new ServiceUnavailableException('bundle storage is not configured')
    return token
  }
}
