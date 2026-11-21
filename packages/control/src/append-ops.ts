import {
  acceptAppend,
  blobRefsOf,
  canonicalJson,
  stepVisibility,
  type LogHead,
  type PluginViewFold,
  type SessionViewState,
  type V2Event,
} from '@dltech/atlas-core'
import type { z } from 'zod'

import { runAppendHooks, type AppendHook } from './append-hooks'
import { missingBlobHashes, verifyBlobWrites } from './blob-ops'
import { UnknownThreadError } from './errors'
import { initialLease } from './lease-ops'
import { parseAppendEvents } from './parse-append'
import {
  SeqConflictError,
  type BlobWrite,
  type ControlTx,
  type SessionViewRow,
  type StoredEvent,
  type ThreadRow,
} from './port'
import type { AppendOutcome, ControlRefusal } from './refusal'
import { settleInputRow } from './settle-input-row'
import { encodeViewState } from './session-view-codec'
import { appendToViewIn, branchRowsOf, catchUpSessionViewIn, foldEvents } from './session-view-ops'
import { decodeVisibility, toStoredEvent } from './stored-event'

type ViewSeat = {
  state: SessionViewState
  row: SessionViewRow | undefined
}

const viewSeatOf = (args: {
  state: SessionViewState | undefined
  threadId: string
  sessionId: string
  events: readonly V2Event[]
  pluginViews?: readonly PluginViewFold[] | undefined
}): ViewSeat | undefined => {
  if (args.state === undefined) return undefined
  const folded = foldEvents({
    state: args.state,
    events: args.events,
    pluginViews: args.pluginViews,
  })
  if (folded.rebuild) return { state: args.state, row: undefined }
  return {
    state: args.state,
    row: {
      sessionId: args.sessionId,
      threadId: args.threadId,
      atSeq: folded.state.at,
      version: folded.state.version,
      state: encodeViewState(folded.state),
    },
  }
}

const settleViewIn = async (args: {
  tx: ControlTx
  sessionId: string
  row: ThreadRow
  seat: ViewSeat
  head: LogHead
  visibility: string
  events: readonly V2Event[]
  eventSchema?: z.ZodType<V2Event> | undefined
  pluginViews?: readonly PluginViewFold[] | undefined
}): Promise<void> => {
  if (args.seat.row !== undefined) {
    const branches = branchRowsOf({ sessionId: args.sessionId, events: args.events })
    if (branches.length > 0) await args.tx.insertSessionBranches(branches)
    return
  }
  await appendToViewIn({
    tx: args.tx,
    sessionId: args.sessionId,
    row: {
      ...args.row,
      headSeq: args.head.seq,
      headHash: args.head.hash,
      visibility: args.visibility,
    },
    state: args.seat.state,
    events: args.events,
    eventSchema: args.eventSchema,
    pluginViews: args.pluginViews,
  })
}

export const appendIn = async (params: {
  tx: ControlTx
  threadId: string
  epoch: number
  events: readonly unknown[]
  blobs?: readonly BlobWrite[] | undefined
  eventSchema?: z.ZodType<V2Event> | undefined
  pluginViews?: readonly PluginViewFold[] | undefined
  appendHooks?: readonly AppendHook[] | undefined
}): Promise<AppendOutcome> => {
  const { tx } = params
  const opening = await tx.openAppend(params.threadId)
  if (opening === undefined) throw new UnknownThreadError(params.threadId)
  const { row } = opening
  const head: LogHead = { seq: row.headSeq, hash: row.headHash }
  const refuse = (refusal: ControlRefusal): AppendOutcome => ({ ok: false, refusal, head })
  const parsed = parseAppendEvents({
    threadId: params.threadId,
    nextSeq: head.seq + 1,
    raw: params.events,
    eventSchema: params.eventSchema,
  })
  if (!parsed.ok) return refuse(parsed.refusal)
  const accepted = acceptAppend({
    head,
    lease: opening.lease ?? initialLease({ sessionId: row.sessionId }),
    epoch: params.epoch,
    events: parsed.events,
  })
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
    await settleInputRow({ tx, sessionId: row.sessionId, event })
    stored.push(toStoredEvent({ event, hash: accepted.hashes[index] as StoredEvent['hash'] }))
  }
  const refHashes = new Set<string>()
  for (const event of parsed.events) {
    for (const ref of blobRefsOf(event)) refHashes.add(ref.hash)
  }
  const state =
    opening.mainThreadId === params.threadId
      ? await catchUpSessionViewIn({
          tx,
          sessionId: row.sessionId,
          row,
          existing: opening.view,
          eventSchema: params.eventSchema,
          pluginViews: params.pluginViews,
        })
      : undefined
  const seat = viewSeatOf({
    state,
    threadId: params.threadId,
    sessionId: row.sessionId,
    events: parsed.events,
    pluginViews: params.pluginViews,
  })
  await tx.insertBlobs(blobs)
  await tx.insertBlobRefs([...refHashes].map((hash) => ({ sessionId: row.sessionId, hash })))
  await runAppendHooks({
    tx,
    sessionId: row.sessionId,
    events: parsed.events,
    hooks: params.appendHooks,
  })
  const swapped = await tx.commitAppend({
    events: stored,
    head: {
      threadId: params.threadId,
      expectedHeadSeq: head.seq,
      headSeq: accepted.head.seq,
      headHash: accepted.head.hash,
      visibility: canonicalJson(visibility),
    },
    ...(seat?.row === undefined ? {} : { view: seat.row }),
    change: { sessionId: row.sessionId, threadId: params.threadId, headSeq: accepted.head.seq },
  })
  if (!swapped) throw new SeqConflictError()
  if (seat !== undefined) {
    await settleViewIn({
      tx,
      sessionId: row.sessionId,
      row,
      seat,
      head: accepted.head,
      visibility: canonicalJson(visibility),
      events: parsed.events,
      eventSchema: params.eventSchema,
      pluginViews: params.pluginViews,
    })
  }
  return { ok: true, head: accepted.head }
}
