import { chainHash, GENESIS_HASH } from '@dltech/atlas-core'
import { EStreamResetReason, STREAM_TAIL_EVENTS } from '@dltech/atlas-protocol'

import { FOLLOW_MAX_RESUME_BEHIND, FOLLOW_TAIL_BYTES } from './follow-limits'
import type { FollowPlane } from './follow-types'

export type StartRequest = { afterSeq: number | undefined; afterHash: string | undefined }

export type StartPosition = {
  cursor: number
  reset: { reason: EStreamResetReason; tailFrom: number } | undefined
}

const hashAt = async (args: {
  plane: FollowPlane
  threadId: string
  seq: number
}): Promise<string | undefined> => {
  if (args.seq === 0) return GENESIS_HASH
  const page = await args.plane.readEvents({
    threadId: args.threadId,
    afterSeq: args.seq - 1,
    limit: 1,
    visible: false,
  })
  const event = page.events[0]
  return event === undefined ? undefined : chainHash(event)
}

const tailCursor = async (args: {
  plane: FollowPlane
  threadId: string
  headSeq: number
}): Promise<number> => {
  const from = Math.max(0, args.headSeq - STREAM_TAIL_EVENTS)
  const page = await args.plane.readEvents({
    threadId: args.threadId,
    afterSeq: from,
    limit: STREAM_TAIL_EVENTS,
    visible: false,
  })
  let bytes = 0
  for (let index = page.events.length - 1; index >= 0; index -= 1) {
    const event = page.events[index]
    if (event === undefined) break
    bytes += Buffer.byteLength(JSON.stringify(event))
    if (bytes > FOLLOW_TAIL_BYTES && index < page.events.length - 1) return event.seq
  }
  return from
}

export const resolveStart = async (args: {
  plane: FollowPlane
  threadId: string
  request: StartRequest
}): Promise<StartPosition> => {
  const { plane, threadId, request } = args
  const head = await plane.head({ threadId })
  const tailFrom = await tailCursor({ plane, threadId, headSeq: head.seq })
  const reset = (reason: EStreamResetReason): StartPosition => ({
    cursor: tailFrom,
    reset: { reason, tailFrom },
  })
  const { afterSeq, afterHash } = request
  if (afterSeq === undefined) return { cursor: tailFrom, reset: undefined }
  if (afterSeq > head.seq) return reset(EStreamResetReason.Ahead)
  if (afterHash !== undefined && (await hashAt({ plane, threadId, seq: afterSeq })) !== afterHash) {
    return reset(EStreamResetReason.Fork)
  }
  if (head.seq - afterSeq > FOLLOW_MAX_RESUME_BEHIND) return reset(EStreamResetReason.TooFarBehind)
  return { cursor: afterSeq, reset: undefined }
}
