import { acceptAppend, blobRefsOf, stepVisibility, type LogHead } from '@dltech/atlas-core'

import { missingBlobHashes, verifyBlobWrites } from './blob-ops'
import { consumeInbox } from './consume-inbox'
import { UnknownThreadError } from './errors'
import type { LeaseOps } from './lease-ops'
import { parseAppendEvents } from './parse-append'
import { SeqConflictError, type BlobWrite, type ControlTx, type StoredEvent } from './port'
import { AppendAbort, type AppendOutcome, type ControlRefusal } from './refusal'
import { decodeVisibility, encodeVisibility, toStoredEvent } from './stored-event'

export const appendIn = async (params: {
  tx: ControlTx
  leases: LeaseOps
  threadId: string
  epoch: number
  events: readonly unknown[]
  blobs?: readonly BlobWrite[] | undefined
}): Promise<AppendOutcome> => {
  const { tx } = params
  const row = await tx.lockThread(params.threadId)
  if (row === undefined) throw new UnknownThreadError(params.threadId)
  const head: LogHead = { seq: row.headSeq, hash: row.headHash }
  const refuse = (refusal: ControlRefusal): AppendOutcome => ({ ok: false, refusal, head })
  const lease = await params.leases.sharedLeaseOf({ tx, sessionId: row.sessionId })
  const parsed = parseAppendEvents({
    threadId: params.threadId,
    nextSeq: head.seq + 1,
    raw: params.events,
  })
  if (!parsed.ok) return refuse(parsed.refusal)
  const accepted = acceptAppend({ head, lease, epoch: params.epoch, events: parsed.events })
  if (!accepted.ok) return refuse(accepted.refusal)

  const blobs = params.blobs ?? []
  const mismatch = verifyBlobWrites(blobs)
  if (mismatch !== undefined) return refuse(mismatch)
  const missing = await missingBlobHashes({ tx, events: parsed.events, blobs })
  if (missing !== undefined) return refuse(missing)

  let visibility = decodeVisibility(row.visibility)
  const stored: StoredEvent[] = []
  for (const [index, event] of parsed.events.entries()) {
    visibility = stepVisibility(visibility, event)
    if (event.type === 'input-consumed') {
      await consumeInbox({
        tx,
        sessionId: row.sessionId,
        inboxId: event.inboxId,
        seq: event.seq,
        head,
      })
    }
    stored.push(toStoredEvent({ event, hash: accepted.hashes[index] as StoredEvent['hash'] }))
  }
  const refHashes = new Set<string>()
  for (const event of parsed.events) {
    for (const ref of blobRefsOf(event)) refHashes.add(ref.hash)
  }
  await tx.insertBlobs(blobs)
  await tx.insertBlobRefs([...refHashes].map((hash) => ({ sessionId: row.sessionId, hash })))
  await tx.insertEvents(stored)
  const swapped = await tx.writeThreadHead({
    threadId: params.threadId,
    expectedHeadSeq: head.seq,
    headSeq: accepted.head.seq,
    headHash: accepted.head.hash,
    visibility: encodeVisibility(visibility),
  })
  if (!swapped) throw new SeqConflictError()
  await tx.announce({
    sessionId: row.sessionId,
    threadId: params.threadId,
    headSeq: accepted.head.seq,
  })
  return { ok: true, head: accepted.head }
}

export const appendRefusalOf = async (params: {
  error: unknown
  currentHead: () => Promise<LogHead>
}): Promise<AppendOutcome> => {
  const { error } = params
  if (error instanceof AppendAbort) return { ok: false, refusal: error.refusal, head: error.head }
  if (!(error instanceof SeqConflictError)) throw error
  const head = await params.currentHead()
  return { ok: false, refusal: { kind: 'seq-mismatch', expected: head.seq + 1 }, head }
}
