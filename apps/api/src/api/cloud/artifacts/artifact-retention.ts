import { Injectable, Logger } from '@nestjs/common'
import { BLOB_PREFIX, blobPathOf, parseManifest } from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'
import { ArtifactBlobStore } from './artifact-blob-store'

export const KEEP_VERSIONS = 20

@Injectable()
export class ArtifactRetention {
  private readonly logger = new Logger(ArtifactRetention.name)

  constructor(private readonly blobs: ArtifactBlobStore) {}

  afterPublish(args: { artifactId: string }): void {
    void this.run({
      work: async () => {
        await this.prune({ artifactId: args.artifactId })
        await this.collectGarbage()
      },
    })
  }

  afterUnpublish(): void {
    void this.run({
      work: async () => {
        await this.collectGarbage()
      },
    })
  }

  async prune(args: { artifactId: string }): Promise<number> {
    const artifact = await db.orm.public.Artifact.first({ id: args.artifactId })
    if (artifact === null) return 0
    const rows = await db.orm.public.ArtifactVersion.where({ artifactId: args.artifactId })
      .orderBy((version) => version.version.desc())
      .all()
    const doomed = rows
      .filter((row, index) => index >= KEEP_VERSIONS && row.version !== artifact.currentVersion)
      .map((row) => row.id)
    for (const id of doomed) {
      await db.orm.public.ArtifactVersion.where({ id }).deleteAndCount()
    }
    this.logger.log(`pruned ${doomed.length} versions of artifact ${args.artifactId}`)
    return doomed.length
  }

  async collectGarbage(): Promise<number> {
    const referenced = await this.referencedShas()
    const stored = await this.blobs.list({ prefix: BLOB_PREFIX })
    const orphans = stored.filter(
      (blob) => !referenced.has(blob.pathname.slice(BLOB_PREFIX.length)),
    )
    for (const orphan of orphans) await this.blobs.delete({ pathname: orphan.pathname })
    this.logger.log(`artifact gc deleted ${orphans.length} of ${stored.length} stored blobs`)
    return orphans.length
  }

  private async referencedShas(): Promise<Set<string>> {
    const rows = await db.orm.public.ArtifactVersion.where((row) => row.id.neq(''))
      .select('id', 'manifest')
      .all()
    const referenced = new Set<string>()
    for (const row of rows) {
      try {
        for (const entry of parseManifest(row.manifest)) referenced.add(entry.sha256)
      } catch (error) {
        this.logger.warn(`skipping unreadable manifest ${row.id}: ${String(error)}`)
      }
    }
    return referenced
  }

  private async run(args: { work: () => Promise<void> }): Promise<void> {
    try {
      await args.work()
    } catch (error) {
      this.logger.error('artifact retention failed', error)
    }
  }
}
