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

const upsertChangedFileIn = async (tx: Tx, file: ChangedFileWrite & { checkoutId: string }) => {
  const fields = {
    oldPath: file.oldPath,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    binary: file.binary,
    baseHash: file.baseHash,
    currentHash: file.currentHash,
    size: file.size,
  }
  await tx.orm.v2.V2WorktreeChangedFile.upsert({
    conflictOn: { checkoutId: file.checkoutId, path: file.path },
    create: { checkoutId: file.checkoutId, path: file.path, ...fields },
    update: fields,
  })
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
  await tx.execute(
    tx.raw.sql`DELETE FROM "v2"."V2WorktreeChangedFile" WHERE "checkoutId" = ${write.checkoutId}`
      .affectedCount()
      .build(),
  )
  for (const file of write.files) {
    await upsertChangedFileIn(tx, { checkoutId: write.checkoutId, ...file })
  }
  await announceIn({ tx, change: { sessionId: params.sessionId } })
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
  const reads: WorktreeChangesRead[] = []
  for (const checkout of checkouts) {
    const files = await tx.orm.v2.V2WorktreeChangedFile.where({ checkoutId: checkout.id })
      .orderBy((row) => row.path.asc())
      .all()
    reads.push({
      checkoutId: checkout.id,
      sessionId: checkout.sessionId,
      repo: checkout.repo,
      worktreePath: checkout.worktreePath,
      base: checkout.base,
      fingerprint: checkout.fingerprint,
      updatedAt: checkout.updatedAt.getTime(),
      files: files.map(fileOf),
    })
  }
  return reads
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
