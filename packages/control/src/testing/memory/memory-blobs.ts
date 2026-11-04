import type { BlobRow, BlobWrite } from '../../port'

export const insertBlobRows = (blobs: Map<string, BlobRow>, rows: readonly BlobWrite[]): void => {
  for (const row of rows) {
    if (blobs.has(row.hash)) continue
    blobs.set(row.hash, {
      size: row.bytes.byteLength,
      bytes: new Uint8Array(row.bytes),
    })
  }
}

export const readBlobRow = (blobs: Map<string, BlobRow>, hash: string): BlobRow | undefined => {
  const row = blobs.get(hash)
  if (row === undefined) return undefined
  return { size: row.size, bytes: new Uint8Array(row.bytes) }
}

export const blobHashesPresent = (
  blobs: Map<string, BlobRow>,
  hashes: readonly string[],
): ReadonlySet<string> => new Set(hashes.filter((hash) => blobs.has(hash)))
