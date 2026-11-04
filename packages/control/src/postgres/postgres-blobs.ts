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
  const row = await tx.orm.v2.V2Blob.first({ hash })
  if (row === null) return undefined
  return { size: row.size, bytes: new Uint8Array(row.bytes) }
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
