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
  type PublishedBundleCommit,
  type PublishedBundleCurrent,
  type PublishedBundleManifest,
  type PublishedBundleSummary,
  type PublishedBundleUpload,
} from '@dltech/atlas-wire'
import { db, violatedConstraint } from '@dltech/atlas-db'
import { BundleBlobStore } from './blob-store'

interface BundleRow {
  version: number
  sha256: string
  sizeBytes: number
  manifest: unknown
  createdAt: Date
}

const VERSION_COLLISION = 'PublishedBundle_userId_version_key'
const PATHNAME_COLLISION = 'PublishedBundle_pathname_key'

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

  async commit(args: {
    userId: string
    body: PublishedBundleCommit
  }): Promise<PublishedBundleSummary> {
    const { pathname, sha256 } = args.body
    if (!pathname.startsWith(prefixOf(args.userId))) {
      throw new BadRequestException('pathname does not belong to this account')
    }
    const manifest = publishedBundleManifestSchema.safeParse(args.body.manifest)
    if (!manifest.success) throw new BadRequestException('manifest is invalid')
    const blob = await this.blobs.head({ pathname })
    if (blob === null) throw new BadRequestException('no uploaded bundle at this pathname')
    if (await db.orm.public.PublishedBundle.first({ pathname })) throw alreadyCommitted()
    const data = {
      pathname,
      sha256,
      manifest: manifest.data,
      blobUrl: blob.url,
      sizeBytes: blob.size,
    }
    const row = await this.insertNextVersion({ userId: args.userId, data, retries: 1 })
    return summaryOf(row)
  }

  async current(args: { userId: string }): Promise<PublishedBundleCurrent> {
    const row = await db.orm.public.PublishedBundle.where({ userId: args.userId })
      .orderBy((bundle) => bundle.version.desc())
      .first()
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
      return await db.transaction(async (tx) => {
        const latest = await tx.orm.public.PublishedBundle.where({ userId: args.userId }).aggregate(
          (aggregate) => ({ maxVersion: aggregate.max('version') }),
        )
        const version = (latest.maxVersion ?? 0) + 1
        return tx.orm.public.PublishedBundle.create({ ...args.data, userId: args.userId, version })
      })
    } catch (error) {
      const constraint = violatedConstraint(error)
      if (constraint === PATHNAME_COLLISION) throw alreadyCommitted()
      if (args.retries > 0 && constraint === VERSION_COLLISION) {
        return this.insertNextVersion({ ...args, retries: args.retries - 1 })
      }
      throw error
    }
  }
}
