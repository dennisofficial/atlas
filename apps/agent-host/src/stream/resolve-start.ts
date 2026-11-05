import { chainHash, GENESIS_HASH } from '@dltech/atlas-core'
import { EStreamResetReason, STREAM_TAIL_EVENTS } from '@dltech/atlas-protocol'

import { FOLLOW_MAX_RESUME_BEHIND } from './follow-limits'
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

export const resolveStart = async (args: {
  plane: FollowPlane
  threadId: string
  request: StartRequest
}): Promise<StartPosition> => {
  const { plane, threadId, request } = args
  const head = await plane.head({ threadId })
  const tailFrom = Math.max(0, head.seq - STREAM_TAIL_EVENTS)
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
