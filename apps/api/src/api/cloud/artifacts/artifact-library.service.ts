import { Injectable, NotFoundException } from '@nestjs/common'
import { sourcePrefixOf, sourceVersionOfKey, sourceVersionPrefixOf } from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'
import {
  type ArtifactGetOutput,
  ArtifactListOutput,
  ArtifactSourceExportOutput,
  ArtifactSummary,
} from '@dltech/atlas-wire'
import { EnvService } from '../../../_core/config/env/env.service'
import type { ArtifactBlobSummary } from './artifact-blob-store'
import { ArtifactBlobStore } from './artifact-blob-store'
import { liveVersionOf } from './artifact-route'
import { buildOf, summaryOf, type ArtifactRow } from './artifact-rows'
import { buildRowOf, ownedArtifact, urlOf } from './artifact-repository'

export const DOWNLOAD_TTL_MS = 60 * 60 * 1000

type ExportEntry = ArtifactSourceExportOutput['entries'][number]

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

  async get(args: { userId: string; subdomain: string }): Promise<ArtifactGetOutput> {
    const artifact = await ownedArtifact(args)
    const build = await buildRowOf(artifact)
    return {
      artifact: summaryOf({ artifact, build, url: this.urlOf(artifact) }),
      build: buildOf({ artifact, build }),
    }
  }

  async sourceExport(args: {
    userId: string
    subdomain: string
  }): Promise<ArtifactSourceExportOutput> {
    const artifact = await ownedArtifact(args)
    const id = artifact.subdomain
    const live = await liveVersionOf({ blobs: this.blobs, id })
    const versioned = live === 0 ? [] : await this.versionedExports({ id, version: live })
    const entries = versioned.length > 0 ? versioned : await this.legacyExports({ id })
    const sorted = entries.sort((left, right) => (left.path < right.path ? -1 : 1))
    if (sorted.length === 0)
      throw new NotFoundException(`${args.subdomain} has no published source`)
    return { entries: sorted }
  }

  private async versionedExports(args: { id: string; version: number }): Promise<ExportEntry[]> {
    const prefix = sourceVersionPrefixOf({ id: args.id, version: args.version })
    const listed = await this.blobs.list({ prefix })
    return this.signed({ listed, pathOf: (pathname) => pathname.slice(prefix.length) })
  }

  private async legacyExports(args: { id: string }): Promise<ExportEntry[]> {
    const prefix = sourcePrefixOf({ id: args.id })
    const listed = await this.blobs.list({ prefix })
    return this.signed({
      listed,
      pathOf: (pathname) =>
        sourceVersionOfKey({ id: args.id, key: pathname }) === null
          ? pathname.slice(prefix.length)
          : null,
    })
  }

  private async signed(args: {
    listed: readonly ArtifactBlobSummary[]
    pathOf: (pathname: string) => string | null
  }): Promise<ExportEntry[]> {
    const entries: ExportEntry[] = []
    for (const blob of args.listed) {
      const path = args.pathOf(blob.pathname)
      if (path === null || path.length === 0) continue
      entries.push({
        path,
        url: await this.blobs.presignDownload({ pathname: blob.pathname, ttlMs: DOWNLOAD_TTL_MS }),
      })
    }
    return entries
  }

  private urlOf(artifact: ArtifactRow): string {
    return urlOf({ artifact, domain: this.env.get('ARTIFACT_DOMAIN') })
  }
}
