import { blobRefsOf, sha256Hex, type V2Event } from '@dltech/atlas-core'

import type { BlobRefusal } from './refusal'
import type { BlobRow, BlobWrite, ControlTx } from './port'

export const verifyBlobWrites = (blobs: readonly BlobWrite[]): BlobRefusal | undefined => {
  for (const blob of blobs) {
    if (sha256Hex(blob.bytes) !== blob.hash) return { kind: 'blob-mismatch', hash: blob.hash }
  }
  return undefined
}

export const missingBlobHashes = async (params: {
  tx: ControlTx
  events: readonly V2Event[]
  blobs: readonly BlobWrite[]
}): Promise<BlobRefusal | undefined> => {
  const supplied = new Set(params.blobs.map((blob) => blob.hash))
  const wanted = new Set<string>()
  for (const event of params.events) {
    for (const ref of blobRefsOf(event)) {
      if (!supplied.has(ref.hash)) wanted.add(ref.hash)
    }
  }
  if (wanted.size === 0) return undefined
  const present = await params.tx.blobsExist([...wanted])
  for (const hash of wanted) {
    if (!present.has(hash)) return { kind: 'blob-missing', hash }
  }
  return undefined
}

export const readBlobIn = async (params: {
  tx: ControlTx
  hash: string
  offset?: number | undefined
  length?: number | undefined
}): Promise<BlobRow | undefined> => {
  const row = await params.tx.readBlob({ hash: params.hash })
  if (row === undefined) return undefined
  const offset = Math.max(0, params.offset ?? 0)
  const end =
    params.length === undefined
      ? row.bytes.byteLength
      : Math.min(row.bytes.byteLength, offset + Math.max(0, params.length))
  return { size: row.size, bytes: row.bytes.subarray(offset, end) }
}
