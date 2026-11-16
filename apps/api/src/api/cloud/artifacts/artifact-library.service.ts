import { Injectable, NotFoundException } from '@nestjs/common'
import { sourcePrefixOf } from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'
import {
  artifactBuildOutcomeSchema,
  type ArtifactBuildOutcome,
  type ArtifactBuildStatusOutput,
  type ArtifactGetOutput,
  ArtifactListOutput,
  ArtifactSourceExportOutput,
  ArtifactSummary,
} from '@dltech/atlas-wire'
import { EnvService } from '../../../_core/config/env/env.service'
import { ArtifactBlobStore } from './artifact-blob-store'
import { buildOf, summaryOf, type ArtifactRow } from './artifact-rows'
import { buildRowOf, buildRowOfVersion, ownedArtifact, urlOf } from './artifact-repository'

export const DOWNLOAD_TTL_MS = 60 * 60 * 1000

export const ARTIFACT_BUILD_STALE_MS = 40 * 60 * 1000

export const STALE_BUILD_FAILURE = 'the build job stopped without reporting a result'

const isStale = (row: { status: string; createdAt: Date }): boolean =>
  row.status === 'building' && Date.now() - row.createdAt.getTime() > ARTIFACT_BUILD_STALE_MS

const outcomeOf = (status: string): ArtifactBuildOutcome => {
  const parsed = artifactBuildOutcomeSchema.safeParse(status)
  return parsed.success ? parsed.data : 'failed'
}

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

  async buildStatus(args: {
    userId: string
    subdomain: string
    version: number
  }): Promise<ArtifactBuildStatusOutput> {
    const artifact = await ownedArtifact(args)
    const row = await buildRowOfVersion({ artifactId: artifact.id, version: args.version })
    const newer = artifact.currentVersion > args.version ? artifact.currentVersion : null
    const base = { subdomain: artifact.subdomain, version: args.version, url: this.urlOf(artifact) }
    if (row === null) {
      if (newer === null) {
        throw new NotFoundException(`${args.subdomain} has no version ${args.version}`)
      }
      return {
        ...base,
        outcome: 'superseded',
        failure: null,
        log: null,
        durationMs: null,
        supersededBy: newer,
      }
    }
    if (isStale(row)) {
      return {
        ...base,
        outcome: 'failed',
        failure: STALE_BUILD_FAILURE,
        log: row.log,
        durationMs: null,
        supersededBy: null,
      }
    }
    const outcome = outcomeOf(row.status)
    return {
      ...base,
      outcome,
      failure: row.failure,
      log: row.log,
      durationMs: row.durationMs,
      supersededBy: outcome === 'superseded' ? newer : null,
    }
  }

  async sourceExport(args: {
    userId: string
    subdomain: string
  }): Promise<ArtifactSourceExportOutput> {
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
    if (sorted.length === 0)
      throw new NotFoundException(`${args.subdomain} has no published source`)
    return { entries: sorted }
  }

  private urlOf(artifact: ArtifactRow): string {
    return urlOf({ artifact, domain: this.env.get('ARTIFACT_DOMAIN') })
  }
}
