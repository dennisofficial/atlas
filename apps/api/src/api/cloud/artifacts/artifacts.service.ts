import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
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
  routePrefixOf,
  sourcePathOf,
  sourcePrefixOf,
  specHash,
  type ArtifactSpec,
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
import { ArtifactBuild } from './artifact-build'
import type { ArtifactBuildOwner } from './artifact-sandbox'
import { ArtifactBlobStore } from './artifact-blob-store'
import type { ArtifactRow, BuildRow } from './artifact-rows'
import { writeArtifactRoute } from './artifact-route'
import { ownedById, resolveArtifact } from './artifact-record'
import { buildRowOfVersion, urlOf } from './artifact-repository'
import { pruneTree, sourceFilesOf, sourceKeysOf, writeRouteTree } from './artifact-tree'

const VERSION_COLLISION = 'ArtifactVersion_artifactId_version_key'

const ATTEMPTS = 3

const EMPTY_SPEC_HASH = specHash(parseSpec({}))

const storedSpecOf = (spec: ArtifactSpec) => ({
  serve:
    spec.serve.notFound === undefined
      ? { spa: spec.serve.spa }
      : { spa: spec.serve.spa, notFound: spec.serve.notFound },
  publish: { include: [...spec.publish.include], exclude: [...spec.publish.exclude] },
})

const totalBytesOf = (entries: readonly ManifestEntry[]): number =>
  entries.reduce((total, entry) => total + entry.size, 0)

@Injectable()
export class ArtifactsService {
  constructor(
    private readonly blobs: ArtifactBlobStore,
    private readonly env: EnvService,
    private readonly build: ArtifactBuild,
  ) {}

  async beginPublish(args: {
    userId: string
    body: ArtifactBeginPublishInput
  }): Promise<ArtifactBeginPublishOutput> {
    const entries = this.parseEntries(args.body.entries)
    await this.assertPublishQuota({ userId: args.userId, entries })
    const artifact = await resolveArtifact({
      userId: args.userId,
      slug: args.body.slug,
      name: args.body.name,
    })
    const version = await this.openBuild({ artifact, entries })
    return {
      artifactId: artifact.id,
      token: artifact.subdomain,
      slug: artifact.subdomain,
      version,
      uploads: await this.sourceUploads({ artifact, entries }),
    }
  }

  async commitPublish(args: {
    userId: string
    threadId: string | undefined
    body: ArtifactCommitPublishInput
  }): Promise<ArtifactCommitPublishOutput> {
    const spec = this.readSpec(args.body.spec)
    const artifact = await ownedById({ userId: args.userId, artifactId: args.body.artifactId })
    const row = await buildRowOfVersion({
      artifactId: artifact.id,
      version: args.body.version,
    })
    if (row === null) throw new NotFoundException(`no version ${args.body.version}`)
    const entries = parseManifest(row.manifest)
    const source = await sourceFilesOf({ blobs: this.blobs, id: artifact.subdomain, entries })
    if ('missing' in source) {
      throw new BadRequestException(`no uploaded source for ${source.missing}`)
    }
    const url = urlOf({ artifact, domain: this.env.get('ARTIFACT_DOMAIN') })
    const built =
      spec.build === undefined
        ? null
        : await this.build.run({
            owner: this.buildOwnerOf({ userId: args.userId, threadId: args.threadId }),
            spec,
            files: source.files,
          })
    if (built !== null && built.status === 'failed') {
      await this.recordBuild({
        row,
        status: 'failed',
        failure: built.failure,
        log: built.log,
        durationMs: built.durationMs,
      })
      return { slug: artifact.subdomain, version: row.version, url, status: 'failed' }
    }
    const files = built === null ? source.files : built.files
    const keys = await writeRouteTree({ blobs: this.blobs, id: artifact.subdomain, files })
    await writeArtifactRoute({ blobs: this.blobs, artifact, spec })
    await pruneTree({
      blobs: this.blobs,
      prefix: routePrefixOf({ id: artifact.subdomain }),
      keep: keys,
    })
    await pruneTree({
      blobs: this.blobs,
      prefix: sourcePrefixOf({ id: artifact.subdomain }),
      keep: sourceKeysOf({ id: artifact.subdomain, entries }),
    })
    await this.recordBuild({
      row,
      status: 'ready',
      failure: null,
      log: built?.log ?? null,
      durationMs: built?.durationMs ?? null,
      spec,
      bytes: files.reduce((total, file) => total + file.content.length, 0),
      fileCount: files.length,
    })
    return { slug: artifact.subdomain, version: row.version, url, status: 'ready' }
  }

  private async recordBuild(args: {
    row: BuildRow
    status: 'ready' | 'failed'
    failure: string | null
    log: string | null
    durationMs: number | null
    spec?: ArtifactSpec
    bytes?: number
    fileCount?: number
  }): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.orm.public.ArtifactVersion.where({ id: args.row.id }).update({
        status: args.status,
        failure: args.failure,
        log: args.log,
        durationMs: args.durationMs,
        ...(args.spec === undefined
          ? {}
          : { spec: storedSpecOf(args.spec), specHash: specHash(args.spec) }),
        ...(args.bytes === undefined ? {} : { bytes: args.bytes }),
        ...(args.fileCount === undefined ? {} : { fileCount: args.fileCount }),
      })
      const previous = await tx.orm.public.ArtifactVersion.where({
        artifactId: args.row.artifactId,
      }).all()
      for (const older of previous) {
        if (older.version === args.row.version) continue
        await tx.orm.public.ArtifactVersion.where({ id: older.id }).deleteAndCount()
      }
    })
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

  private readSpec(raw: unknown): ArtifactSpec {
    try {
      return parseSpec(raw)
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'spec is invalid')
    }
  }

  private buildOwnerOf(args: { userId: string; threadId: string | undefined }): ArtifactBuildOwner {
    return args.threadId === undefined ? { userId: args.userId } : { threadId: args.threadId }
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
            status: 'building',
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
