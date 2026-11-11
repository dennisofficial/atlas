import { Injectable, NotFoundException } from '@nestjs/common'
import { sourcePrefixOf } from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'
import type {
  ArtifactGetOutput,
  ArtifactListOutput,
  ArtifactSourceExportOutput,
  ArtifactSummary,
} from '@dltech/atlas-wire'
import { EnvService } from '../../../_core/config/env/env.service'
import { ArtifactBlobStore } from './artifact-blob-store'
import { buildOf, summaryOf, type ArtifactRow } from './artifact-rows'
import { buildRowOf, ownedArtifact, urlOf } from './artifact-repository'

export const DOWNLOAD_TTL_MS = 60 * 60 * 1000

@Injectable()
export class ArtifactLibraryService {
  constructor(
    private readonly blobs: ArtifactBlobStore,
    private readonly env: EnvService,
  ) {}

  async list(args: { userId: string }): Promise<ArtifactListOutput> {
    const rows = await db.orm.public.Artifact.where({ userId: args.userId })
      .orderBy((artifact) => artifact.updatedAt.desc())
      .all()
    const artifacts: ArtifactSummary[] = []
    for (const artifact of rows) {
      artifacts.push(
        summaryOf({
          artifact,
          build: await buildRowOf(artifact),
          url: this.urlOf(artifact),
        }),
      )
    }
    return { artifacts }
  }

  async get(args: { userId: string; slug: string }): Promise<ArtifactGetOutput> {
    const artifact = await ownedArtifact(args)
    const build = await buildRowOf(artifact)
    return {
      artifact: summaryOf({ artifact, build, url: this.urlOf(artifact) }),
      build: buildOf({ artifact, build }),
    }
  }

  async sourceExport(args: { userId: string; slug: string }): Promise<ArtifactSourceExportOutput> {
    const artifact = await ownedArtifact(args)
    const prefix = sourcePrefixOf({ id: artifact.subdomain })
    const listed = await this.blobs.list({ prefix })
    const entries: ArtifactSourceExportOutput['entries'] = []
    for (const blob of listed) {
      if (!blob.pathname.startsWith(prefix)) continue
      const path = blob.pathname.slice(prefix.length)
      if (path.length === 0) continue
      entries.push({
        path,
        url: await this.blobs.presignDownload({ pathname: blob.pathname, ttlMs: DOWNLOAD_TTL_MS }),
      })
    }
    const sorted = entries.sort((left, right) => (left.path < right.path ? -1 : 1))
    if (sorted.length === 0) throw new NotFoundException(`${args.slug} has no published source`)
    return { entries: sorted }
  }

  private urlOf(artifact: ArtifactRow): string {
    return urlOf({ artifact, domain: this.env.get('ARTIFACT_DOMAIN') })
  }
}
