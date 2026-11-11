import { Injectable } from '@nestjs/common'
import { blobPathOf, type ManifestEntry } from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'
import type {
  ArtifactGetOutput,
  ArtifactListOutput,
  ArtifactSourceExportOutput,
  ArtifactSummary,
} from '@dltech/atlas-wire'
import { EnvService } from '../../../_core/config/env/env.service'
import { ArtifactBlobStore } from './artifact-blob-store'
import { currentVersionOf, newestVersionOf, ownedArtifact, urlOf } from './artifact-repository'
import {
  manifestOf,
  summaryOf,
  versionSummaryOf,
  type ArtifactRow,
  type VersionRow,
} from './artifact-rows'

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
      const current = await this.shownVersionOf({ artifact })
      artifacts.push(summaryOf({ artifact, current, url: this.urlOf(artifact) }))
    }
    return { artifacts }
  }

  async get(args: { userId: string; slug: string }): Promise<ArtifactGetOutput> {
    const artifact = await ownedArtifact(args)
    const current = await currentVersionOf(artifact)
    const versions = await db.orm.public.ArtifactVersion.where({ artifactId: artifact.id })
      .orderBy((version) => version.version.desc())
      .all()
    return {
      artifact: summaryOf({
        artifact,
        current: current ?? (await newestVersionOf(artifact)),
        url: this.urlOf(artifact),
      }),
      versions: versions.map(versionSummaryOf),
      current: manifestOf(current),
    }
  }

  async sourceExport(args: { userId: string; slug: string }): Promise<ArtifactSourceExportOutput> {
    const artifact = await ownedArtifact(args)
    const source = manifestOf(await currentVersionOf(artifact)).filter(
      (entry: ManifestEntry) => entry.tree === 'src',
    )
    const entries: ArtifactSourceExportOutput['entries'] = []
    for (const entry of source) {
      const url = await this.blobs.presignDownload({
        pathname: blobPathOf(entry.sha256),
        ttlMs: DOWNLOAD_TTL_MS,
      })
      entries.push({ path: entry.path, url })
    }
    return { entries }
  }

  private async shownVersionOf(args: { artifact: ArtifactRow }): Promise<VersionRow | null> {
    const current = await currentVersionOf(args.artifact)
    return current ?? newestVersionOf(args.artifact)
  }

  private urlOf(artifact: ArtifactRow): string {
    return urlOf({ artifact, domain: this.env.get('ARTIFACT_DOMAIN') })
  }
}
