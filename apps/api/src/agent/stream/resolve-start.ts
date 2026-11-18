import { chainHash, GENESIS_HASH } from '@dltech/atlas-core'
import { EStreamResetReason } from '@dltech/atlas-protocol'

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
  const reset = (reason: EStreamResetReason): StartPosition => ({
    cursor: 0,
    reset: { reason, tailFrom: 0 },
  })
  const { afterSeq, afterHash } = request
  if (afterSeq === undefined) return { cursor: 0, reset: undefined }
  if (afterSeq > head.seq) return reset(EStreamResetReason.Ahead)
  if (afterHash !== undefined && (await hashAt({ plane, threadId, seq: afterSeq })) !== afterHash) {
    return reset(EStreamResetReason.Fork)
  }
  return { cursor: afterSeq, reset: undefined }
}
