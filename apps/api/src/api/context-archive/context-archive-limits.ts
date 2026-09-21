import { PayloadTooLargeException } from '@nestjs/common'

/**
 * The sanity cap on a tar.gz context archive (sandbox workspace context or user memory), raw
 * bytes over the wire. `express.raw` buffers the whole body into memory before a handler ever
 * runs, Prisma then holds the whole bytea column, and `StreamableFile` holds the whole buffer
 * again on the way back out — this is a deliberate per-request memory budget sized against the
 * API container, not a streaming limit. The #485 OOM was a 109MB `writeFiles` push through an SDK
 * that multiplied the buffer several times over; a single buffered body at this cap is the
 * accepted bound. Kept in lockstep with `MAX_CONTEXT_ARCHIVE_BYTES` in
 * `packages/harness/src/cloud/sandbox-client.ts` — `apps/api` carries no in-repo dependency by
 * design (see its AGENTS.md), so the value is duplicated rather than imported.
 */
export const MAX_CONTEXT_ARCHIVE_BYTES = 256 * 1024 * 1024

const mebibytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)}MiB`

export function assertArchiveWithinLimit(args: { bytes: number }): void {
  if (args.bytes <= MAX_CONTEXT_ARCHIVE_BYTES) return
  throw new PayloadTooLargeException(
    `the context archive is ${mebibytes(args.bytes)}, over the ${mebibytes(MAX_CONTEXT_ARCHIVE_BYTES)} limit`,
  )
}
