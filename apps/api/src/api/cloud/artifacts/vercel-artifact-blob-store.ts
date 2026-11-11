import { BlobNotFoundError, del, head, issueSignedToken, list, presignUrl, put } from '@vercel/blob'
import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import {
  ArtifactBlobStore,
  type ArtifactBlobHead,
  type ArtifactBlobSummary,
  type PresignedUpload,
} from './artifact-blob-store'

const UPLOAD_TTL_MS = 15 * 60 * 1000

const BLOB_CONTENT_TYPE = 'application/octet-stream'

const LIST_PAGE_SIZE = 1000

const DOWNLOAD_TTL_MS = 15 * 60 * 1000

@Injectable()
export class VercelArtifactBlobStore extends ArtifactBlobStore {
  constructor(private readonly env: EnvService) {
    super()
  }

  async presignUpload(args: { pathname: string; maxBytes: number }): Promise<PresignedUpload> {
    const token = this.token()
    const validUntil = Date.now() + UPLOAD_TTL_MS
    const constraints = {
      allowedContentTypes: [BLOB_CONTENT_TYPE],
      maximumSizeInBytes: args.maxBytes,
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
      access: 'public',
      validUntil,
      addRandomSuffix: false,
      allowOverwrite: false,
      ...constraints,
    })
    return { url: presignedUrl, validUntil }
  }

  async presignDownload(args: { pathname: string; ttlMs: number }): Promise<string> {
    const validUntil = Date.now() + args.ttlMs
    const signed = await issueSignedToken({
      token: this.token(),
      pathname: args.pathname,
      operations: ['get'],
      validUntil,
    })
    const { presignedUrl } = await presignUrl(signed, {
      operation: 'get',
      pathname: args.pathname,
      access: 'public',
      validUntil,
    })
    return presignedUrl
  }

  async head(args: { pathname: string }): Promise<ArtifactBlobHead | null> {
    try {
      const found = await head(args.pathname, { token: this.token() })
      return { url: found.url, size: found.size }
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null
      throw error
    }
  }

  async put(args: {
    pathname: string
    body: string | Buffer
    contentType: string
    allowOverwrite: boolean
  }): Promise<void> {
    await put(args.pathname, args.body, {
      token: this.token(),
      access: 'public',
      contentType: args.contentType,
      addRandomSuffix: false,
      allowOverwrite: args.allowOverwrite,
    })
  }

  async read(args: { pathname: string }): Promise<Buffer | null> {
    const url = await this.presignDownload({ pathname: args.pathname, ttlMs: DOWNLOAD_TTL_MS })
    const response = await fetch(url)
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`blob ${args.pathname} answered ${response.status}`)
    }
    return Buffer.from(await response.arrayBuffer())
  }

  async delete(args: { pathname: string }): Promise<void> {
    await del(args.pathname, { token: this.token() })
  }

  async list(args: { prefix: string }): Promise<ArtifactBlobSummary[]> {
    const found: ArtifactBlobSummary[] = []
    let cursor: string | undefined
    for (;;) {
      const page = await list({
        token: this.token(),
        prefix: args.prefix,
        limit: LIST_PAGE_SIZE,
        ...(cursor === undefined ? {} : { cursor }),
      })
      for (const blob of page.blobs) found.push({ pathname: blob.pathname, size: blob.size })
      if (!page.hasMore || page.cursor === undefined) return found
      cursor = page.cursor
    }
  }

  private token(): string {
    const token = this.env.get('ARTIFACT_BLOB_READ_WRITE_TOKEN')
    if (!token) throw new ServiceUnavailableException('artifact storage is not configured')
    return token
  }
}
