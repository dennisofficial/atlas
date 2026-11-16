import { specHash, type ArtifactSpec } from '@dltech/atlas-artifacts'
import { db } from '@dltech/atlas-db'
import type { Tx } from '@dltech/atlas-db'
export type VersionRow = { id: string; artifactId: string; version: number }

export enum EBuildStatus {
  Building = 'building',
  Ready = 'ready',
  Failed = 'failed',
  Superseded = 'superseded',
}

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

export async function markFailed(args: {
  rowId: string
  failure: string
  log: string | null
  durationMs: number | null
}): Promise<void> {
  await db.orm.public.ArtifactVersion.where({ id: args.rowId }).update({
    status: EBuildStatus.Failed,
    failure: args.failure,
    log: args.log,
    durationMs: args.durationMs,
  })
}

const deleteLowerVersions = async (args: { tx: Tx; row: VersionRow }): Promise<void> => {
  await args.tx.orm.public.ArtifactVersion.where({ artifactId: args.row.artifactId })
    .where((lower) => lower.version.lt(args.row.version))
    .deleteAndCount()
}

export async function markReadyWithin(args: {
  tx: Tx
  row: VersionRow
  spec: ArtifactSpec
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
    ...specOfRow(args.spec),
  })
  await deleteLowerVersions({ tx: args.tx, row: args.row })
}
