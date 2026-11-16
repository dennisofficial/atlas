import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import {
  MAX_BYTES_PER_VERSION,
  exceededBy,
  manifestHash,
  parseManifest,
  parseSpec,
  routePrefixOf,
  routeVersionOfKey,
  sourcePrefixOf,
  sourceVersionOfKey,
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
import { ArtifactBlobStore } from './artifact-blob-store'
import { assertPublishQuota, storedBytesOf } from './artifact-quota'
import { withArtifactLock } from './artifact-lock'
import { assertUploaded, pushedSpec } from './artifact-push'
import { ownedById, resolveArtifact } from './artifact-record'
import type { ArtifactRow } from './artifact-rows'
import { buildRowOfVersion, urlOf } from './artifact-repository'
import { liveVersionOf, writeArtifactRoute } from './artifact-route'
import { pruneBelow, removeTree } from './artifact-tree'
import { uploadsOf } from './artifact-uploads'
import { EBuildStatus, markFailed, markReadyWithin, type VersionRow } from './artifact-versions'

const VERSION_COLLISION = 'ArtifactVersion_artifactId_version_key'

const ATTEMPTS = 3

const EMPTY_SPEC_HASH = specHash(parseSpec({}))

const logger = new Logger('ArtifactsService')

export const SERVER_BUILD_GONE =
  'This Atlas version pushes without building, and a session keeps the Atlas version it started with. Start a new session and push from there; its artifact_push builds in the session. artifact_pull works from this session.'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const conflictOf = (args: {
  version: number
  live: number
  subdomain: string
}): ConflictException =>
  new ConflictException(
    `version ${args.version} is older than the live version ${args.live} of ${args.subdomain}; pull it, reapply your change and push again`,
  )

@Injectable()
export class ArtifactsService {
  constructor(
    private readonly blobs: ArtifactBlobStore,
    private readonly env: EnvService,
  ) {}

  async beginPublish(args: {
    userId: string
    body: ArtifactBeginPublishInput
  }): Promise<ArtifactBeginPublishOutput> {
    const entries = this.parseEntries(args.body.entries)
    await assertPublishQuota({ userId: args.userId, entries })
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
      uploads: await this.presignedUploads({ artifact, entries, version }),
    }
  }

  async commitPublish(args: {
    userId: string
    body: ArtifactCommitPublishInput
  }): Promise<ArtifactCommitPublishOutput> {
    const artifact = await ownedById({ userId: args.userId, artifactId: args.body.artifactId })
    const id = artifact.subdomain
    const row = await buildRowOfVersion({ artifactId: artifact.id, version: args.body.version })
    if (row === null) {
      const live = await liveVersionOf({ blobs: this.blobs, id })
      if (live === args.body.version) return this.readyOf({ artifact, version: args.body.version })
      if (live < args.body.version) throw new NotFoundException(`no version ${args.body.version}`)
      await this.removeVersionFolders({ id, version: args.body.version })
      throw conflictOf({ version: args.body.version, live, subdomain: id })
    }
    const entries = parseManifest(row.manifest)
    await assertUploaded({ blobs: this.blobs, id, version: row.version, entries })
    const spec = await pushedSpec({ blobs: this.blobs, id, version: row.version, entries })
    const log = args.body.log ?? null
    const durationMs = args.body.durationMs ?? null
    await this.refuseServerBuild({ row, spec, entries, log, durationMs })
    await this.switchLive({ artifact, row, spec, entries, log, durationMs })
    await this.pruneBelow({ id, version: row.version })
    return this.readyOf({ artifact, version: row.version })
  }

  private readyOf(args: { artifact: ArtifactRow; version: number }): ArtifactCommitPublishOutput {
    return {
      subdomain: args.artifact.subdomain,
      version: args.version,
      url: urlOf({ artifact: args.artifact, domain: this.env.get('ARTIFACT_DOMAIN') }),
      status: 'ready',
    }
  }

  private async refuseServerBuild(args: {
    row: { id: string }
    spec: ArtifactSpec
    entries: readonly ManifestEntry[]
    log: string | null
    durationMs: number | null
  }): Promise<void> {
    if (args.spec.build === undefined) return
    if (args.entries.some((entry) => entry.tree === 'dist')) return
    await markFailed({
      rowId: args.row.id,
      failure: SERVER_BUILD_GONE,
      log: args.log,
      durationMs: args.durationMs,
    })
    throw new BadRequestException(SERVER_BUILD_GONE)
  }

  private async switchLive(args: {
    artifact: ArtifactRow
    row: VersionRow
    spec: ArtifactSpec
    entries: readonly ManifestEntry[]
    log: string | null
    durationMs: number | null
  }): Promise<void> {
    try {
      await withArtifactLock({
        artifactId: args.artifact.id,
        work: async (tx) => {
          const current = await tx.orm.public.Artifact.first({ id: args.artifact.id })
          if (current === null) throw new NotFoundException('no such artifact')
          const live = await liveVersionOf({ blobs: this.blobs, id: current.subdomain })
          if (live === args.row.version) return
          if (live > args.row.version) {
            throw conflictOf({
              version: args.row.version,
              live,
              subdomain: current.subdomain,
            })
          }
          await markReadyWithin({
            tx,
            row: args.row,
            spec: args.spec,
            log: args.log,
            durationMs: args.durationMs,
            bytes: storedBytesOf(args.entries),
            fileCount: args.entries.length,
          })
          await writeArtifactRoute({
            blobs: this.blobs,
            artifact: current,
            spec: args.spec,
            version: args.row.version,
          })
        },
      })
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error
      await this.removeVersionFolders({ id: args.artifact.subdomain, version: args.row.version })
      throw error
    }
  }

  private async pruneBelow(args: { id: string; version: number }): Promise<void> {
    try {
      await pruneBelow({
        blobs: this.blobs,
        prefix: routePrefixOf({ id: args.id }),
        version: args.version,
        versionOfKey: (key) => routeVersionOfKey({ id: args.id, key }),
      })
      await pruneBelow({
        blobs: this.blobs,
        prefix: sourcePrefixOf({ id: args.id }),
        version: args.version,
        versionOfKey: (key) => sourceVersionOfKey({ id: args.id, key }),
      })
    } catch (error) {
      logger.warn(`could not prune the version folders of ${args.id}: ${messageOf(error)}`)
    }
  }

  private async removeVersionFolders(args: { id: string; version: number }): Promise<void> {
    try {
      await removeTree({
        blobs: this.blobs,
        prefix: `${sourcePrefixOf({ id: args.id })}v${args.version}/`,
      })
      await removeTree({
        blobs: this.blobs,
        prefix: `${routePrefixOf({ id: args.id })}v${args.version}/`,
      })
    } catch (error) {
      logger.warn(`could not remove version ${args.version} of ${args.id}: ${messageOf(error)}`)
    }
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
            bytes: storedBytesOf(args.entries),
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

  private async presignedUploads(args: {
    artifact: ArtifactRow
    entries: readonly ManifestEntry[]
    version: number
  }): Promise<ArtifactUpload[]> {
    const uploads: ArtifactUpload[] = []
    const grants = uploadsOf({
      id: args.artifact.subdomain,
      version: args.version,
      entries: args.entries,
    })
    for (const grant of grants) {
      const { url } = await this.blobs.presignUpload({
        pathname: grant.pathname,
        maxBytes: MAX_BYTES_PER_VERSION,
      })
      uploads.push({ path: grant.path, tree: grant.tree, sha256: grant.sha256, url })
    }
    return uploads
  }
}
