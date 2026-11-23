import { randomUUID } from 'node:crypto'
import type { EContextFileKind } from '@dltech/atlas-core'
import type { Tx } from '@dltech/atlas-db'

import type { ContextFileRow, ContextFileWrite } from '../context-files'

const rowOf = (row: {
  path: string
  digest: string | null
  size: number
  mime: string
  kind: string
  mtimeMs: number
  updatedAt: Date
}): ContextFileRow => ({
  path: row.path,
  digest: row.digest,
  size: row.size,
  mime: row.mime,
  kind: row.kind as EContextFileKind,
  mtimeMs: row.mtimeMs,
  updatedAt: row.updatedAt.getTime(),
})

export const CONTEXT_DIGEST_LOCK_NAMESPACE = 1095060565

export const lockContextDigestIn = async (params: { tx: Tx; digest: string }): Promise<void> => {
  await params.tx.query(
    params.tx.raw
      .sql`SELECT pg_advisory_xact_lock(${CONTEXT_DIGEST_LOCK_NAMESPACE}::int, hashtext('context-digest:' || ${params.digest})::int)::text AS "locked"`
      .returnsRow({ locked: 'pg/text@1' })
      .build(),
  )
}

export const upsertContextFilesIn = async (params: {
  tx: Tx
  sessionId: string
  files: readonly ContextFileWrite[]
}): Promise<void> => {
  if (params.files.length === 0) return
  const rows = params.files.map((file) => ({ id: randomUUID(), ...file }))
  await params.tx.execute(
    params.tx.raw.sql`INSERT INTO "v2"."V2ContextFile" ("id", "sessionId", "path", "digest", "size",
        "mime", "kind", "mtimeMs", "updatedAt")
      SELECT f."id", ${params.sessionId}, f."path", f."digest", f."size", f."mime", f."kind",
        f."mtimeMs", clock_timestamp()
        FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS f(
          "id" text, "path" text, "digest" text, "size" int4, "mime" text, "kind" text,
          "mtimeMs" float8)
      ON CONFLICT ("sessionId", "path") DO UPDATE
        SET "digest" = EXCLUDED."digest", "size" = EXCLUDED."size", "mime" = EXCLUDED."mime",
          "kind" = EXCLUDED."kind", "mtimeMs" = EXCLUDED."mtimeMs",
          "updatedAt" = clock_timestamp()`
      .affectedCount()
      .build(),
  )
}

export const removeContextFilesIn = async (params: {
  tx: Tx
  sessionId: string
  paths: readonly string[]
}): Promise<void> => {
  if (params.paths.length === 0) return
  await params.tx.execute(
    params.tx.raw.sql`DELETE FROM "v2"."V2ContextFile"
      WHERE "sessionId" = ${params.sessionId}
        AND "path" IN (SELECT jsonb_array_elements_text(${JSON.stringify(params.paths)}::jsonb))`
      .affectedCount()
      .build(),
  )
}

export const listContextFilesIn = async (params: {
  tx: Tx
  sessionId: string
}): Promise<ContextFileRow[]> => {
  const rows = await params.tx.orm.v2.V2ContextFile.where({ sessionId: params.sessionId })
    .orderBy((row) => row.path.asc())
    .all()
  return rows.map(rowOf)
}

export const contextFileIn = async (params: {
  tx: Tx
  sessionId: string
  path: string
}): Promise<ContextFileRow | null> => {
  const row = await params.tx.orm.v2.V2ContextFile.first({
    sessionId: params.sessionId,
    path: params.path,
  })
  return row === null ? null : rowOf(row)
}

export const contextDigestsReferencedIn = async (params: {
  tx: Tx
  digests: readonly string[]
}): Promise<ReadonlySet<string>> => {
  if (params.digests.length === 0) return new Set()
  const rows = await params.tx.query(
    params.tx.raw.sql`SELECT DISTINCT "digest" FROM "v2"."V2ContextFile"
      WHERE "digest" IN (SELECT jsonb_array_elements_text(${JSON.stringify([...params.digests])}::jsonb))`
      .returnsRow({ digest: 'pg/text@1' })
      .build(),
  )
  return new Set(rows.map((row) => row.digest))
}
