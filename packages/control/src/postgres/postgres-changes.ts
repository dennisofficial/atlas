import type { Tx } from '@dltech/atlas-db'

import type {
  ChangeBlobRow,
  ChangeBlobWrite,
  ChangedFileWrite,
  WorktreeChangesRead,
  WorktreeChangesWrite,
} from '../port'
import { announceIn } from './postgres-notify'

export const insertChangeBlobRows = async (params: {
  tx: Tx
  rows: readonly ChangeBlobWrite[]
}): Promise<void> => {
  const { tx } = params
  for (const row of params.rows) {
    const statement = tx.raw.sql`INSERT INTO "v2"."V2ChangeBlob" ("hash", "size", "createdAt")
      VALUES (${row.hash}, ${row.size}, clock_timestamp())
      ON CONFLICT ("hash") DO NOTHING`
      .affectedCount()
      .build()
    await tx.execute(statement)
  }
}

export const changeBlobHashesPresentIn = async (
  tx: Tx,
  hashes: readonly string[],
): Promise<ReadonlySet<string>> => {
  if (hashes.length === 0) return new Set()
  const rows = await tx.orm.v2.V2ChangeBlob.select('hash')
    .where((b) => b.hash.in([...hashes]))
    .all()
  return new Set(rows.map((row) => row.hash))
}

const fileOf = (row: {
  path: string
  oldPath: string | null
  status: string
  additions: number
  deletions: number
  binary: boolean
  baseHash: string | null
  currentHash: string | null
  size: number | null
}): ChangedFileWrite => ({
  path: row.path,
  oldPath: row.oldPath,
  status: row.status as ChangedFileWrite['status'],
  additions: row.additions,
  deletions: row.deletions,
  binary: row.binary,
  baseHash: row.baseHash,
  currentHash: row.currentHash,
  size: row.size,
})

const sameFile = (stored: ChangedFileWrite, next: ChangedFileWrite): boolean =>
  stored.oldPath === next.oldPath &&
  stored.status === next.status &&
  stored.additions === next.additions &&
  stored.deletions === next.deletions &&
  stored.binary === next.binary &&
  stored.baseHash === next.baseHash &&
  stored.currentHash === next.currentHash &&
  stored.size === next.size

export const diffChangedFiles = (params: {
  stored: readonly ChangedFileWrite[]
  next: readonly ChangedFileWrite[]
}): { removed: readonly string[]; written: readonly ChangedFileWrite[] } => {
  const storedByPath = new Map(params.stored.map((file) => [file.path, file]))
  const nextPaths = new Set(params.next.map((file) => file.path))
  return {
    removed: params.stored.map((file) => file.path).filter((path) => !nextPaths.has(path)),
    written: params.next.filter((file) => {
      const stored = storedByPath.get(file.path)
      return stored === undefined || !sameFile(stored, file)
    }),
  }
}

const storedFilesIn = async (tx: Tx, checkoutId: string): Promise<ChangedFileWrite[]> => {
  const rows = await tx.orm.v2.V2WorktreeChangedFile.where({ checkoutId }).all()
  return rows.map(fileOf)
}

const removeChangedFilesIn = async (params: {
  tx: Tx
  checkoutId: string
  paths: readonly string[]
}): Promise<void> => {
  if (params.paths.length === 0) return
  await params.tx.execute(
    params.tx.raw.sql`DELETE FROM "v2"."V2WorktreeChangedFile"
      WHERE "checkoutId" = ${params.checkoutId}
        AND "path" IN (SELECT jsonb_array_elements_text(${JSON.stringify(params.paths)}::jsonb))`
      .affectedCount()
      .build(),
  )
}

const writeChangedFilesIn = async (params: {
  tx: Tx
  checkoutId: string
  files: readonly ChangedFileWrite[]
}): Promise<void> => {
  if (params.files.length === 0) return
  await params.tx.execute(
    params.tx.raw.sql`INSERT INTO "v2"."V2WorktreeChangedFile" ("checkoutId", "path", "oldPath",
        "status", "additions", "deletions", "binary", "baseHash", "currentHash", "size")
      SELECT ${params.checkoutId}, f."path", f."oldPath", f."status", f."additions", f."deletions",
        f."binary", f."baseHash", f."currentHash", f."size"
        FROM jsonb_to_recordset(${JSON.stringify(params.files)}::jsonb) AS f(
          "path" text, "oldPath" text, "status" text, "additions" int4, "deletions" int4,
          "binary" bool, "baseHash" text, "currentHash" text, "size" int4)
      ON CONFLICT ("checkoutId", "path") DO UPDATE
        SET "oldPath" = EXCLUDED."oldPath", "status" = EXCLUDED."status",
          "additions" = EXCLUDED."additions", "deletions" = EXCLUDED."deletions",
          "binary" = EXCLUDED."binary", "baseHash" = EXCLUDED."baseHash",
          "currentHash" = EXCLUDED."currentHash", "size" = EXCLUDED."size"`
      .affectedCount()
      .build(),
  )
}

export const upsertChangesIn = async (params: {
  tx: Tx
  sessionId: string
  write: WorktreeChangesWrite
  blobs: readonly ChangeBlobWrite[]
}): Promise<void> => {
  const { tx, write } = params
  await insertChangeBlobRows({ tx, rows: params.blobs })
  const updatedAt = new Date(write.updatedAt)
  const fields = {
    sessionId: write.sessionId,
    repo: write.repo,
    worktreePath: write.worktreePath,
    base: write.base,
    fingerprint: write.fingerprint,
    updatedAt,
  }
  await tx.orm.v2.V2WorktreeChanges.upsert({
    conflictOn: { id: write.checkoutId },
    create: { id: write.checkoutId, ...fields },
    update: fields,
  })
  const diff = diffChangedFiles({
    stored: await storedFilesIn(tx, write.checkoutId),
    next: write.files,
  })
  await removeChangedFilesIn({ tx, checkoutId: write.checkoutId, paths: diff.removed })
  await writeChangedFilesIn({ tx, checkoutId: write.checkoutId, files: diff.written })
  await announceIn({ tx, change: { sessionId: params.sessionId } })
}

const filesByCheckoutIn = async (
  tx: Tx,
  checkoutIds: readonly string[],
): Promise<Map<string, ChangedFileWrite[]>> => {
  const grouped = new Map<string, ChangedFileWrite[]>()
  if (checkoutIds.length === 0) return grouped
  const rows = await tx.orm.v2.V2WorktreeChangedFile.where((row) =>
    row.checkoutId.in([...checkoutIds]),
  )
    .orderBy((row) => row.path.asc())
    .all()
  for (const row of rows) {
    const files = grouped.get(row.checkoutId) ?? []
    files.push(fileOf(row))
    grouped.set(row.checkoutId, files)
  }
  return grouped
}

export const readChangesIn = async (params: {
  tx: Tx
  sessionId: string
}): Promise<WorktreeChangesRead[]> => {
  const { tx } = params
  const checkouts = await tx.orm.v2.V2WorktreeChanges.where({
    sessionId: params.sessionId,
  })
    .orderBy((row) => row.updatedAt.desc())
    .all()
  const files = await filesByCheckoutIn(
    tx,
    checkouts.map((checkout) => checkout.id),
  )
  return checkouts.map((checkout) => ({
    checkoutId: checkout.id,
    sessionId: checkout.sessionId,
    repo: checkout.repo,
    worktreePath: checkout.worktreePath,
    base: checkout.base,
    fingerprint: checkout.fingerprint,
    updatedAt: checkout.updatedAt.getTime(),
    files: files.get(checkout.id) ?? [],
  }))
}

export const readChangeFileIn = async (params: {
  tx: Tx
  sessionId: string
  checkoutId: string
  path: string
}): Promise<ChangedFileWrite | undefined> => {
  const { tx } = params
  const checkout = await tx.orm.v2.V2WorktreeChanges.first({
    id: params.checkoutId,
    sessionId: params.sessionId,
  })
  if (checkout === null) return undefined
  const row = await tx.orm.v2.V2WorktreeChangedFile.first({
    checkoutId: params.checkoutId,
    path: params.path,
  })
  return row === null ? undefined : fileOf(row)
}

export const changesUpdatedAtIn = async (params: {
  tx: Tx
  sessionId: string
}): Promise<number | null> => {
  const checkouts = await params.tx.orm.v2.V2WorktreeChanges.where({
    sessionId: params.sessionId,
  }).all()
  if (checkouts.length === 0) return null
  return Math.max(...checkouts.map((row) => row.updatedAt.getTime()))
}

export const changeBlobsUnreferencedIn = async (params: {
  tx: Tx
  olderThanMs: number
  limit: number
}): Promise<readonly ChangeBlobRow[]> => {
  const { tx } = params
  const cutoff = new Date(Date.now() - params.olderThanMs).toISOString()
  const rows = await tx.query(
    tx.raw.sql`SELECT b."hash", b."size", b."createdAt" FROM "v2"."V2ChangeBlob" b
      WHERE b."createdAt" < ${cutoff}
        AND NOT EXISTS (
          SELECT 1 FROM "v2"."V2WorktreeChangedFile" f
          WHERE f."baseHash" = b."hash" OR f."currentHash" = b."hash"
        )
      ORDER BY b."createdAt" LIMIT ${params.limit}`
      .returnsRow({
        hash: 'pg/text@1',
        size: 'pg/int4@1',
        createdAt: tx.sql.v2.V2ChangeBlob.columns.createdAt,
      })
      .build(),
  )
  return rows.map((row) => ({
    hash: row.hash,
    size: row.size,
    createdAt: row.createdAt.getTime(),
  }))
}

export const deleteChangeBlobRowsIn = async (params: {
  tx: Tx
  hashes: readonly string[]
}): Promise<void> => {
  const { tx } = params
  for (const hash of params.hashes) {
    await tx.execute(
      tx.raw.sql`DELETE FROM "v2"."V2ChangeBlob" WHERE "hash" = ${hash}`.affectedCount().build(),
    )
  }
}
