import { randomBytes, randomUUID } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  MAX_BYTES_PER_USER,
  MAX_BYTES_PER_VERSION,
  blobPathOf,
  exceededBy,
  manifestHash,
  parseManifest,
  parseSpec,
  specHash,
  type ArtifactSpec,
  type ManifestEntry,
} from '@dltech/atlas-artifacts'
import { randomToken } from '@dltech/atlas-artifacts/node'
import { db, isUniqueViolation, violatedConstraint } from '@dltech/atlas-db'
import type {
  ArtifactBeginPublishInput,
  ArtifactBeginPublishOutput,
  ArtifactCommitPublishInput,
  ArtifactCommitPublishOutput,
  ArtifactUpload,
} from '@dltech/atlas-wire'
import { EnvService } from '../../../_core/config/env/env.service'
import { ArtifactBuild } from './artifact-build'
import { ArtifactBlobStore } from './artifact-blob-store'
import { missingBlobs, presentShas, urlOf } from './artifact-repository'
import { ArtifactRetention } from './artifact-retention'
import { totalBytesOf, type ArtifactRow } from './artifact-rows'
import { writeArtifactRoute } from './artifact-route'

const VERSION_COLLISION = 'ArtifactVersion_artifactId_version_key'

const SLUG_MAX_LENGTH = 39

const EMPTY_SPEC_HASH = specHash(parseSpec({}))

const slugFrom = (name: string): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '')
  return slug.length === 0 ? 'artifact' : slug
}

const storedSpecOf = (spec: ArtifactSpec) => ({
  serve:
    spec.serve.notFound === undefined
      ? { spa: spec.serve.spa }
      : { spa: spec.serve.spa, notFound: spec.serve.notFound },
  publish: { include: [...spec.publish.include], exclude: [...spec.publish.exclude] },
})

const withDistCopy = (entries: readonly ManifestEntry[]): ManifestEntry[] => {
  const source = entries.filter((entry) => entry.tree === 'src')
  const dist = entries.filter((entry) => entry.tree === 'dist')
  if (dist.length > 0) return [...source, ...dist]
  return [...source, ...source.map((entry) => ({ ...entry, tree: 'dist' as const }))]
}

@Injectable()
export class ArtifactsService {
  constructor(
    private readonly blobs: ArtifactBlobStore,
    private readonly retention: ArtifactRetention,
    private readonly env: EnvService,
    private readonly build: ArtifactBuild,
  ) {}

  async beginPublish(args: {
    userId: string
    body: ArtifactBeginPublishInput
  }): Promise<ArtifactBeginPublishOutput> {
    const entries = this.parseEntries(args.body.entries)
    await this.assertPublishQuota({ userId: args.userId, entries })
    const artifact = await this.resolveArtifact({
      userId: args.userId,
      slug: args.body.slug,
      name: args.body.name,
    })
    const version = await this.insertVersion({ artifact, entries })
    const uploads = await this.missingUploads(entries)
    return {
      artifactId: artifact.id,
      token: artifact.token,
      slug: artifact.slug,
      version,
      uploads,
    }
  }

  async commitPublish(args: {
    userId: string
    threadId: string | undefined
    body: ArtifactCommitPublishInput
  }): Promise<ArtifactCommitPublishOutput> {
    const spec = this.readSpec(args.body.spec)
    const artifact = await db.orm.public.Artifact.first({ id: args.body.artifactId })
    if (artifact === null || artifact.userId !== args.userId) {
      throw new NotFoundException('no such artifact')
    }
    const version = await db.orm.public.ArtifactVersion.first({
      artifactId: artifact.id,
      version: args.body.version,
    })
    if (version === null) throw new NotFoundException(`no version ${args.body.version}`)
    const stored = parseManifest(version.manifest)
    const firstMissing = (await missingBlobs({ blobs: this.blobs, entries: stored }))[0]
    if (firstMissing !== undefined) {
      throw new BadRequestException(
        `no uploaded content for ${firstMissing.tree}/${firstMissing.path}`,
      )
    }
    const built =
      spec.build === undefined
        ? null
        : await this.build.run({
            threadId: this.threadOf(args.threadId),
            spec,
            source: stored,
          })
    if (built !== null && built.status === 'failed') {
      await db.orm.public.ArtifactVersion.where({ id: version.id }).update({
        status: 'failed',
        failure: built.failure,
        log: built.log,
        durationMs: built.durationMs,
      })
      return {
        slug: artifact.slug,
        version: args.body.version,
        url: urlOf({ artifact, domain: this.env.get('ARTIFACT_DOMAIN') }),
        status: 'failed',
      }
    }
    const manifest =
      built === null
        ? withDistCopy(stored)
        : [...stored.filter((entry) => entry.tree === 'src'), ...built.manifest]
    await db.transaction(async (tx) => {
      await tx.orm.public.ArtifactVersion.where({ id: version.id }).update({
        status: 'ready',
        manifest,
        spec: storedSpecOf(spec),
        specHash: specHash(spec),
        bytes: totalBytesOf(manifest),
        fileCount: manifest.length,
        log: built?.log ?? null,
        durationMs: built?.durationMs ?? null,
      })
      await tx.orm.public.Artifact.where({ id: artifact.id }).update({
        currentVersion: args.body.version,
      })
    })
    await writeArtifactRoute({
      blobs: this.blobs,
      artifact,
      version: args.body.version,
      manifest,
      spec,
    })
    this.retention.afterPublish({ artifactId: artifact.id })
    return {
      slug: artifact.slug,
      version: args.body.version,
      url: urlOf({ artifact, domain: this.env.get('ARTIFACT_DOMAIN') }),
      status: 'ready',
    }
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
    const versions = await db.orm.public.ArtifactVersion.where((version) =>
      version.artifactId.in(artifacts.map((artifact) => artifact.id)),
    ).all()
    return versions.reduce((total, version) => total + version.bytes, 0)
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

  private threadOf(threadId: string | undefined): string {
    if (threadId === undefined) {
      throw new BadRequestException(
        "a build runs on the publishing pod's Vercel credentials: publish it with a sandbox or pod token",
      )
    }
    return threadId
  }

  private async resolveArtifact(args: {
    userId: string
    slug: string | undefined
    name: string | undefined
  }): Promise<ArtifactRow> {
    if (args.slug !== undefined) {
      const existing = await db.orm.public.Artifact.first({
        userId: args.userId,
        slug: args.slug,
      })
      if (existing === null) throw new NotFoundException(`no artifact ${args.slug}`)
      return existing
    }
    const name = args.name ?? 'artifact'
    const base = slugFrom(name)
    for (let attempt = 0; attempt < 3; attempt++) {
      const slug = attempt === 0 ? base : `${base.slice(0, 30)}-${randomToken(randomBytes(4))}`
      try {
        return await db.orm.public.Artifact.create({
          id: randomUUID(),
          userId: args.userId,
          slug,
          token: randomToken(randomBytes(8)),
          name,
          currentVersion: 0,
        })
      } catch (error) {
        if (!isUniqueViolation(error)) throw error
      }
    }
    throw new ConflictException('could not allocate an artifact slug')
  }

  private async insertVersion(args: {
    artifact: ArtifactRow
    entries: ManifestEntry[]
  }): Promise<number> {
    const sourceHash = manifestHash(args.entries.filter((entry) => entry.tree === 'src'))
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.transaction(async (tx) => {
          const latest = await tx.orm.public.ArtifactVersion.where({
            artifactId: args.artifact.id,
          }).aggregate((aggregate) => ({ maxVersion: aggregate.max('version') }))
          const version = (latest.maxVersion ?? 0) + 1
          await tx.orm.public.ArtifactVersion.create({
            id: randomUUID(),
            artifactId: args.artifact.id,
            version,
            status: 'building',
            manifest: args.entries,
            spec: {},
            sourceHash,
            specHash: EMPTY_SPEC_HASH,
            bytes: totalBytesOf(args.entries),
            fileCount: args.entries.length,
          })
          return version
        })
      } catch (error) {
        if (attempt > 0 || violatedConstraint(error) !== VERSION_COLLISION) throw error
      }
    }
  }

  private async missingUploads(entries: readonly ManifestEntry[]): Promise<ArtifactUpload[]> {
    const bySha = new Map<string, ManifestEntry>()
    for (const entry of entries) if (!bySha.has(entry.sha256)) bySha.set(entry.sha256, entry)
    const present = await presentShas({ blobs: this.blobs, shas: [...bySha.keys()] })
    const uploads: ArtifactUpload[] = []
    for (const entry of bySha.values()) {
      if (present.has(entry.sha256)) continue
      const { url } = await this.blobs.presignUpload({
        pathname: blobPathOf(entry.sha256),
        maxBytes: MAX_BYTES_PER_VERSION,
      })
      uploads.push({ path: entry.path, tree: entry.tree, sha256: entry.sha256, url })
    }
    return uploads
  }
}
