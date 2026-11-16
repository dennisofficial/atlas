import { Logger } from '@nestjs/common'
import { parseManifest, routeVersionPrefixOf, type ArtifactSpec } from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'
import type { ArtifactBlobStore } from './artifact-blob-store'
import { ArtifactBuild, type ArtifactBuildResult } from './artifact-build'
import {
  EArtifactBuildOutcome,
  type ArtifactBuildPayload,
  type ArtifactBuildTaskOutput,
} from './artifact-build.contract'
import { withArtifactLock } from './artifact-lock'
import type { BuildRow } from './artifact-rows'
import { liveVersionOf, writeArtifactRoute } from './artifact-route'
import { specOfFiles, verifiedSourceOf } from './artifact-push'
import type { ArtifactSandboxFile } from './artifact-sandbox'
import { pruneRoutesBelow, removeTree, writeRouteTree } from './artifact-tree'
import {
  currentVersionOf,
  finishBuilding,
  markReadyWithin,
  markSuperseded,
  recordBuild,
  EBuildStatus,
} from './artifact-versions'

export type ArtifactBuildDeps = {
  blobs: ArtifactBlobStore
  build: ArtifactBuild
}

const SOURCE_CHANGED = 'the pushed source changed before the build read it'

enum ESwitchOutcome {
  Ready = 'ready',
  Superseded = 'superseded',
  Abandoned = 'abandoned',
}

const outcomeOf = (status: string): EArtifactBuildOutcome =>
  status === EBuildStatus.Ready
    ? EArtifactBuildOutcome.Ready
    : status === EBuildStatus.Superseded
      ? EArtifactBuildOutcome.Superseded
      : EArtifactBuildOutcome.Failed

const ownerOf = (payload: ArtifactBuildPayload) =>
  payload.threadId === undefined ? { userId: payload.userId } : { threadId: payload.threadId }

export async function runArtifactBuild(args: {
  payload: ArtifactBuildPayload
  deps: ArtifactBuildDeps
}): Promise<ArtifactBuildTaskOutput> {
  const { payload, deps } = args
  const artifact = await db.orm.public.Artifact.first({ id: payload.artifactId })
  const row =
    artifact === null
      ? null
      : await db.orm.public.ArtifactVersion.first({
          artifactId: artifact.id,
          version: payload.version,
        })
  if (artifact === null || row === null) return { outcome: EArtifactBuildOutcome.Failed }
  if (row.status !== EBuildStatus.Building) return { outcome: outcomeOf(row.status) }

  const abandoned = await abandonIfNewer({ row, artifactId: artifact.id })
  if (abandoned !== null) return abandoned

  const id = artifact.subdomain
  const entries = parseManifest(row.manifest)
  const source = await verifiedSourceOf({ blobs: deps.blobs, id, entries })
  if ('changed' in source) {
    const changed = await abandonIfNewer({ row, artifactId: artifact.id, failure: SOURCE_CHANGED })
    return changed ?? { outcome: EArtifactBuildOutcome.Failed }
  }

  const parsed = specOfFiles(source.files)
  if ('failure' in parsed) {
    await recordBuild({
      row,
      status: EBuildStatus.Failed,
      failure: parsed.failure,
      log: null,
      durationMs: null,
    })
    return { outcome: EArtifactBuildOutcome.Failed }
  }
  const spec = parsed.spec

  const built =
    spec.build === undefined
      ? null
      : await deps.build.run({ owner: ownerOf(payload), spec, files: source.files })
  if (built !== null && built.status === 'failed') {
    await recordBuild({
      row,
      status: EBuildStatus.Failed,
      failure: built.failure,
      log: built.log,
      durationMs: built.durationMs,
    })
    return { outcome: EArtifactBuildOutcome.Failed }
  }
  const files = built === null ? source.files : built.files

  await writeRouteTree({ blobs: deps.blobs, id, version: row.version, files })

  const switched = await switchVersion({
    artifactId: artifact.id,
    row,
    spec,
    built,
    files,
    deps,
  })
  if (switched !== ESwitchOutcome.Ready) {
    await removeTree({
      blobs: deps.blobs,
      prefix: routeVersionPrefixOf({ id, version: row.version }),
    })
    if (switched === ESwitchOutcome.Abandoned) return { outcome: EArtifactBuildOutcome.Failed }
    await markSuperseded({ rowId: row.id })
    return { outcome: EArtifactBuildOutcome.Superseded }
  }

  await pruneQuietly({ blobs: deps.blobs, id, version: row.version })
  return { outcome: EArtifactBuildOutcome.Ready }
}

async function switchVersion(args: {
  artifactId: string
  row: BuildRow
  spec: ArtifactSpec
  built: Extract<ArtifactBuildResult, { status: 'ready' }> | null
  files: readonly ArtifactSandboxFile[]
  deps: ArtifactBuildDeps
}): Promise<ESwitchOutcome> {
  return withArtifactLock({
    artifactId: args.artifactId,
    work: async (tx) => {
      const artifact = await tx.orm.public.Artifact.first({ id: args.artifactId })
      if (artifact === null) return ESwitchOutcome.Abandoned
      const live = await liveVersionOf({ blobs: args.deps.blobs, id: artifact.subdomain })
      if (artifact.currentVersion > args.row.version || live >= args.row.version) {
        return ESwitchOutcome.Superseded
      }
      await markReadyWithin({
        tx,
        row: args.row,
        log: args.built?.log ?? null,
        durationMs: args.built?.durationMs ?? null,
        bytes: args.files.reduce((total, file) => total + file.content.length, 0),
        fileCount: args.files.length,
      })
      await writeArtifactRoute({
        blobs: args.deps.blobs,
        artifact,
        spec: args.spec,
        version: args.row.version,
      })
      return ESwitchOutcome.Ready
    },
  })
}

async function pruneQuietly(args: {
  blobs: ArtifactBlobStore
  id: string
  version: number
}): Promise<void> {
  try {
    await pruneRoutesBelow(args)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    new Logger('ArtifactBuild').warn(`could not prune the route tree of ${args.id}: ${reason}`)
  }
}

async function abandonIfNewer(args: {
  row: BuildRow
  artifactId: string
  failure?: string
}): Promise<ArtifactBuildTaskOutput | null> {
  const current = await currentVersionOf(args.artifactId)
  if (current === null || current > args.row.version) {
    await markSuperseded({ rowId: args.row.id })
    return { outcome: EArtifactBuildOutcome.Superseded }
  }
  if (args.failure === undefined) return null
  await recordBuild({
    row: args.row,
    status: EBuildStatus.Failed,
    failure: args.failure,
    log: null,
    durationMs: null,
  })
  return { outcome: EArtifactBuildOutcome.Failed }
}

export async function failArtifactBuild(args: {
  payload: ArtifactBuildPayload
  deps: ArtifactBuildDeps
  error: unknown
}): Promise<void> {
  const artifact = await db.orm.public.Artifact.first({ id: args.payload.artifactId })
  if (artifact === null) return
  const live = await liveVersionOf({ blobs: args.deps.blobs, id: artifact.subdomain })
  if (live === args.payload.version) {
    await finishBuilding({
      artifactId: args.payload.artifactId,
      version: args.payload.version,
      status: EBuildStatus.Ready,
      failure: null,
    })
    return
  }
  const reason = args.error instanceof Error ? args.error.message : String(args.error)
  await finishBuilding({
    artifactId: args.payload.artifactId,
    version: args.payload.version,
    status: EBuildStatus.Failed,
    failure: `the build job stopped before finishing: ${reason}`,
  })
}
