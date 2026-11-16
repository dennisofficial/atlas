import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  MAX_BYTES_PER_USER,
  MAX_BYTES_PER_VERSION,
  exceededBy,
  manifestHash,
  parseManifest,
  parseSpec,
  sourcePathOf,
  specHash,
  type ManifestEntry,
} from '@dltech/atlas-artifacts'
import { db, violatedConstraint } from '@dltech/atlas-db'
import type {
  ArtifactBeginPublishInput,
  ArtifactBeginPublishOutput,
  ArtifactCommitPublishInput,
  ArtifactCommitPublishOutput,
  ArtifactUpload,
} from '@dltech/atlas-wire'
import { EnvService } from '../../../_core/config/env/env.service'
import { JobDispatcher } from '../../../_core/ports/job-dispatcher'
import { artifactBuildIdempotencyKey, artifactBuildTaskContract } from './artifact-build.contract'
import { ArtifactBlobStore } from './artifact-blob-store'
import { assertUploaded, pruneSource, pushedSpec } from './artifact-push'
import { ownedById, resolveArtifact } from './artifact-record'
import type { ArtifactRow } from './artifact-rows'
import { buildRowOfVersion, urlOf } from './artifact-repository'
import {
  recordBuild,
  storeBuildSpec,
  supersedeBuildingBelow,
  EBuildStatus,
} from './artifact-versions'

const VERSION_COLLISION = 'ArtifactVersion_artifactId_version_key'

const ATTEMPTS = 3

const EMPTY_SPEC_HASH = specHash(parseSpec({}))

const totalBytesOf = (entries: readonly ManifestEntry[]): number =>
  entries.reduce((total, entry) => total + entry.size, 0)

@Injectable()
export class ArtifactsService {
  constructor(
    private readonly blobs: ArtifactBlobStore,
    private readonly env: EnvService,
    @Inject(JobDispatcher) private readonly jobs: JobDispatcher,
  ) {}

  async beginPublish(args: {
    userId: string
    body: ArtifactBeginPublishInput
  }): Promise<ArtifactBeginPublishOutput> {
    const entries = this.parseEntries(args.body.entries)
    await this.assertPublishQuota({ userId: args.userId, entries })
    const artifact = await resolveArtifact({
      userId: args.userId,
      subdomain: args.body.subdomain,
      name: args.body.name,
    })
    const version = await this.openBuild({ artifact, entries })
    return {
      artifactId: artifact.id,
      token: artifact.subdomain,
      subdomain: artifact.subdomain,
      version,
      uploads: await this.sourceUploads({ artifact, entries }),
    }
  }

  async commitPublish(args: {
    userId: string
    threadId: string | undefined
    body: ArtifactCommitPublishInput
  }): Promise<ArtifactCommitPublishOutput> {
    const artifact = await ownedById({ userId: args.userId, artifactId: args.body.artifactId })
    const row = await buildRowOfVersion({
      artifactId: artifact.id,
      version: args.body.version,
    })
    if (row === null) throw new NotFoundException(`no version ${args.body.version}`)
    const entries = parseManifest(row.manifest)
    const id = artifact.subdomain
    await assertUploaded({ blobs: this.blobs, id, entries })
    await pruneSource({ blobs: this.blobs, id, entries })
    const spec = await pushedSpec({ blobs: this.blobs, id, entries })
    await storeBuildSpec({ rowId: row.id, spec })
    await supersedeBuildingBelow({ artifactId: artifact.id, version: row.version })
    const url = urlOf({ artifact, domain: this.env.get('ARTIFACT_DOMAIN') })
    const payload = {
      artifactId: artifact.id,
      version: row.version,
      userId: args.userId,
      ...(args.threadId === undefined ? {} : { threadId: args.threadId }),
    }
    try {
      await this.jobs.dispatch({
        task: artifactBuildTaskContract,
        payload,
        idempotencyKey: artifactBuildIdempotencyKey(payload),
        tags: [`artifact:${id}`],
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      await recordBuild({
        row,
        status: EBuildStatus.Failed,
        failure: `could not start the build: ${reason}`,
        log: null,
        durationMs: null,
      })
      return { subdomain: id, version: row.version, url, status: 'failed' }
    }
    return { subdomain: id, version: row.version, url, status: 'building' }
  }

  private async assertPublishQuota(args: {
    userId: string
    entries: readonly ManifestEntry[]
  }): Promise<void> {
    const stored = await this.storedBytesOf(args.userId)
    if (stored + totalBytesOf(args.entries) <= MAX_BYTES_PER_USER) return
    throw new BadRequestException(
      `this publish would take you past the ${MAX_BYTES_PER_USER} byte ceiling for artifacts; unpublish one to make room`,
    )
  }

  private async storedBytesOf(userId: string): Promise<number> {
    const artifacts = await db.orm.public.Artifact.where({ userId }).all()
    if (artifacts.length === 0) return 0
    const rows = await db.orm.public.ArtifactVersion.where((row) =>
      row.artifactId.in(artifacts.map((artifact) => artifact.id)),
    ).all()
    return rows.reduce((total, row) => total + row.bytes, 0)
  }

  private parseEntries(raw: readonly ManifestEntry[]): ManifestEntry[] {
    let entries: ManifestEntry[]
    try {
      entries = parseManifest(raw)
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'manifest is invalid')
    }
    const exceeded = exceededBy(entries)
    if (exceeded !== null) throw new BadRequestException(exceeded.reason)
    return entries
  }

  private async openBuild(args: {
    artifact: ArtifactRow
    entries: readonly ManifestEntry[]
  }): Promise<number> {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      try {
        return await db.transaction(async (tx) => {
          const artifact = await tx.orm.public.Artifact.first({ id: args.artifact.id })
          const version = (artifact?.currentVersion ?? 0) + 1
          await tx.orm.public.ArtifactVersion.create({
            id: randomUUID(),
            artifactId: args.artifact.id,
            version,
            status: EBuildStatus.Building,
            manifest: args.entries,
            spec: {},
            sourceHash: manifestHash(args.entries),
            specHash: EMPTY_SPEC_HASH,
            bytes: totalBytesOf(args.entries),
            fileCount: args.entries.length,
          })
          await tx.orm.public.Artifact.where({ id: args.artifact.id }).update({
            currentVersion: version,
          })
          return version
        })
      } catch (error) {
        if (attempt > 0 || violatedConstraint(error) !== VERSION_COLLISION) throw error
      }
    }
    throw new ConflictException('could not open a build for this artifact')
  }

  private async sourceUploads(args: {
    artifact: ArtifactRow
    entries: readonly ManifestEntry[]
  }): Promise<ArtifactUpload[]> {
    const uploads: ArtifactUpload[] = []
    for (const entry of args.entries) {
      const pathname = sourcePathOf({ id: args.artifact.subdomain, path: entry.path })
      const { url } = await this.blobs.presignUpload({
        pathname,
        maxBytes: MAX_BYTES_PER_VERSION,
      })
      uploads.push({ path: entry.path, tree: entry.tree, sha256: entry.sha256, url })
    }
    return uploads
  }
}
