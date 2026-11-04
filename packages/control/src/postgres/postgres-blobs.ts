import type { Tx } from '@dltech/atlas-db'

import type { BlobRow, BlobWrite } from '../port'

export const insertBlobRows = async (tx: Tx, rows: readonly BlobWrite[]): Promise<void> => {
  for (const row of rows) {
    const statement = tx.raw.sql`INSERT INTO "v2"."V2Blob" ("hash", "bytes", "size", "createdAt")
      VALUES (${row.hash}, ${Buffer.from(row.bytes)}, ${row.bytes.byteLength}, clock_timestamp())
      ON CONFLICT ("hash") DO NOTHING`
      .affectedCount()
      .build()
    await tx.execute(statement)
  }
}

export const readBlobRow = async (tx: Tx, hash: string): Promise<BlobRow | undefined> => {
  const [row] = await tx.query(
    tx.raw.sql`SELECT "size", encode("bytes", 'base64') AS "b64"
      FROM "v2"."V2Blob" WHERE "hash" = ${hash}`
      .returnsRow({ size: 'pg/int4@1', b64: 'pg/text@1' })
      .build(),
  )
  if (row === undefined) return undefined
  return { size: row.size, bytes: new Uint8Array(Buffer.from(row.b64, 'base64')) }
}

export const blobHashesPresent = async (
  tx: Tx,
  hashes: readonly string[],
): Promise<ReadonlySet<string>> => {
  if (hashes.length === 0) return new Set()
  const rows = await tx.orm.v2.V2Blob.select('hash')
    .where((b) => b.hash.in([...hashes]))
    .all()
  return new Set(rows.map((row) => row.hash))
}

export const blobReferencedIn = async (
  tx: Tx,
  params: { sessionId: string; hash: string },
): Promise<boolean> => {
  const [row] = await tx.query(
    tx.raw.sql`SELECT EXISTS (
      SELECT 1 FROM "v2"."V2Event" e
      JOIN "v2"."V2Thread" t ON t."id" = e."threadId"
      WHERE t."sessionId" = ${params.sessionId}
        AND position(${params.hash} in e."canonical") > 0
    ) AS "found"`
      .returnsRow({ found: 'pg/bool@1' })
      .build(),
  )
  return row?.found === true
}
