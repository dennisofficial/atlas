import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  PUBLISHED_BUNDLE_CONTENT_TYPE,
  PUBLISHED_BUNDLE_MAX_BYTES,
  publishedBundleManifestSchema,
  type PublishedBundleCurrent,
  type PublishedBundleManifest,
  type PublishedBundleSummary,
  type PublishedBundleUpload,
} from '@dltech/atlas-wire'
import { db } from '../../../db'
import { isUniqueViolation } from '../github/unique-violation'
import { BundleBlobStore } from './blob-store'
import type { CommitBundleDto } from './published-bundles.dto'

interface BundleRow {
  version: number
  sha256: string
  sizeBytes: number
  manifest: unknown
  createdAt: Date
}

const VERSION_COLLISION = ['userId', 'version']
const PATHNAME_COLLISION = ['pathname']

const prefixOf = (userId: string): string => `bundles/${userId}/`

const summaryOf = (row: BundleRow): PublishedBundleSummary => ({
  version: row.version,
  sha256: row.sha256,
  sizeBytes: row.sizeBytes,
  manifest: publishedBundleManifestSchema.parse(row.manifest),
  createdAt: row.createdAt.toISOString(),
})

const alreadyCommitted = (): ConflictException =>
  new ConflictException('this upload is already committed')

@Injectable()
export class PublishedBundlesService {
  constructor(private readonly blobs: BundleBlobStore) {}

  async issueUpload(args: { userId: string }): Promise<PublishedBundleUpload> {
    const pathname = `${prefixOf(args.userId)}${randomUUID()}.tar.gz`
    const { uploadUrl, validUntil } = await this.blobs.presignUpload({ pathname })
    return {
      pathname,
      uploadUrl,
      contentType: PUBLISHED_BUNDLE_CONTENT_TYPE,
      maximumSizeInBytes: PUBLISHED_BUNDLE_MAX_BYTES,
      validUntil,
    }
  }

  async commit(args: { userId: string; body: CommitBundleDto }): Promise<PublishedBundleSummary> {
    const { pathname, sha256 } = args.body
    if (!pathname.startsWith(prefixOf(args.userId))) {
      throw new BadRequestException('pathname does not belong to this account')
    }
    const manifest = publishedBundleManifestSchema.safeParse(args.body.manifest)
    if (!manifest.success) throw new BadRequestException('manifest is invalid')
    const blob = await this.blobs.head({ pathname })
    if (blob === null) throw new BadRequestException('no uploaded bundle at this pathname')
    if (await db.publishedBundle.findUnique({ where: { pathname } })) throw alreadyCommitted()
    const data = { pathname, sha256, manifest: manifest.data, blobUrl: blob.url, sizeBytes: blob.size }
    const row = await this.insertNextVersion({ userId: args.userId, data, retries: 1 })
    return summaryOf(row)
  }

  async current(args: { userId: string }): Promise<PublishedBundleCurrent> {
    const row = await db.publishedBundle.findFirst({
      where: { userId: args.userId },
      orderBy: { version: 'desc' },
    })
    if (row === null) throw new NotFoundException('no published bundle')
    const { downloadUrl } = await this.blobs.presignDownload({ pathname: row.pathname })
    return { ...summaryOf(row), downloadUrl }
  }

  private async insertNextVersion(args: {
    userId: string
    data: {
      pathname: string
      sha256: string
      manifest: PublishedBundleManifest
      blobUrl: string
      sizeBytes: number
    }
    retries: number
  }): Promise<BundleRow> {
    try {
      return await db.$transaction(async (tx) => {
        const latest = await tx.publishedBundle.aggregate({
          where: { userId: args.userId },
          _max: { version: true },
        })
        const version = (latest._max.version ?? 0) + 1
        return tx.publishedBundle.create({ data: { ...args.data, userId: args.userId, version } })
      })
    } catch (error) {
      if (isUniqueViolation(error, PATHNAME_COLLISION)) throw alreadyCommitted()
      if (args.retries > 0 && isUniqueViolation(error, VERSION_COLLISION)) {
        return this.insertNextVersion({ ...args, retries: args.retries - 1 })
      }
      throw error
    }
  }
}
