import { specHash, type ArtifactSpec } from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'
import type { Tx } from '@dltech/atlas-db'
import type { BuildRow } from './artifact-rows'

export const storedSpecOf = (spec: ArtifactSpec) => ({
  serve:
    spec.serve.notFound === undefined
      ? { spa: spec.serve.spa }
      : { spa: spec.serve.spa, notFound: spec.serve.notFound },
  publish: { include: [...spec.publish.include], exclude: [...spec.publish.exclude] },
})

export const specOfRow = (spec: ArtifactSpec) => ({
  spec: storedSpecOf(spec),
  specHash: specHash(spec),
})

export async function storeBuildSpec(args: { rowId: string; spec: ArtifactSpec }): Promise<void> {
  await db.orm.public.ArtifactVersion.where({ id: args.rowId }).update(specOfRow(args.spec))
}

export async function supersedeBuildingBelow(args: {
  artifactId: string
  version: number
}): Promise<number> {
  const rows = await db.orm.public.ArtifactVersion.where({
    artifactId: args.artifactId,
    status: EBuildStatus.Building,
  }).all()
  const doomed = rows.filter((row) => row.version < args.version)
  for (const row of doomed) await markSuperseded({ rowId: row.id })
  return doomed.length
}

export enum EBuildStatus {
  Building = 'building',
  Ready = 'ready',
  Failed = 'failed',
  Superseded = 'superseded',
}

export async function markSuperseded(args: { rowId: string }): Promise<void> {
  await db.orm.public.ArtifactVersion.where({ id: args.rowId }).update({
    status: EBuildStatus.Superseded,
  })
}

const deleteLowerVersions = async (args: { tx: Tx; row: BuildRow }): Promise<void> => {
  await args.tx.orm.public.ArtifactVersion.where({ artifactId: args.row.artifactId })
    .where((lower) => lower.version.lt(args.row.version))
    .deleteAndCount()
}

export async function markReadyWithin(args: {
  tx: Tx
  row: BuildRow
  log: string | null
  durationMs: number | null
  bytes: number
  fileCount: number
}): Promise<void> {
  await args.tx.orm.public.ArtifactVersion.where({ id: args.row.id }).update({
    status: EBuildStatus.Ready,
    failure: null,
    log: args.log,
    durationMs: args.durationMs,
    bytes: args.bytes,
    fileCount: args.fileCount,
  })
  await deleteLowerVersions({ tx: args.tx, row: args.row })
}

export async function recordBuild(args: {
  row: BuildRow
  status: EBuildStatus.Ready | EBuildStatus.Failed
  failure: string | null
  log: string | null
  durationMs: number | null
  bytes?: number
  fileCount?: number
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.orm.public.ArtifactVersion.where({ id: args.row.id }).update({
      status: args.status,
      failure: args.failure,
      log: args.log,
      durationMs: args.durationMs,
      ...(args.bytes === undefined ? {} : { bytes: args.bytes }),
      ...(args.fileCount === undefined ? {} : { fileCount: args.fileCount }),
    })
    await deleteLowerVersions({ tx, row: args.row })
  })
}

export async function finishBuilding(args: {
  artifactId: string
  version: number
  status: EBuildStatus.Ready | EBuildStatus.Failed
  failure: string | null
}): Promise<void> {
  const row = await db.orm.public.ArtifactVersion.first({
    artifactId: args.artifactId,
    version: args.version,
  })
  if (row === null || row.status !== EBuildStatus.Building) return
  await db.orm.public.ArtifactVersion.where({ id: row.id }).update({
    status: args.status,
    failure: args.failure,
  })
}

export async function currentVersionOf(artifactId: string): Promise<number | null> {
  const artifact = await db.orm.public.Artifact.first({ id: artifactId })
  return artifact?.currentVersion ?? null
}
