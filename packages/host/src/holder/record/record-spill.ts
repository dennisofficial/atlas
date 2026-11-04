import {
  blobRefsOf,
  blobValueOf,
  spillBody,
  type BlobPayload,
  type V2Body,
} from '@dltech/atlas-core'
import type { LogPort } from '@dltech/atlas-observability'

export const spillForAppend = (args: {
  body: V2Body
  thresholdBytes: number
  log?: LogPort | undefined
}): { body: V2Body; blobs: BlobPayload[]; resolved: Map<string, unknown> } => {
  const spilled = spillBody({ body: args.body, thresholdBytes: args.thresholdBytes })
  const resolved = new Map<string, unknown>()
  for (const [index, blob] of spilled.blobs.entries()) {
    resolved.set(blob.hash, blobValueOf(blob.bytes))
    args.log?.info({
      source: 'holder.record',
      message: 'spilled a large field to a blob',
      data: {
        field: blobRefsOf(spilled.body)[index]?.field ?? 'unknown',
        size: blob.bytes.byteLength,
      },
    })
  }
  return { body: spilled.body, blobs: spilled.blobs, resolved }
}
