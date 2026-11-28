import { GENESIS_HASH, SESSION_VIEW_VERSION } from '@dltech/atlas-core'
import {
  type EStreamCacheOutcome,
  EStreamResetReason,
  STREAM_TAIL_EVENTS,
  STREAM_TOO_FAR_BEHIND_EVENTS,
} from '@dltech/atlas-protocol'

import type { FollowPlane } from './follow-types'

export type StartRequest = {
  afterSeq: number | undefined
  afterHash: string | undefined
  tailViewVersion?: number | undefined
  cache?: EStreamCacheOutcome | undefined
  hydrateMs?: number | undefined
}

export type StartPosition = {
  cursor: number
  reset: { reason: EStreamResetReason; tailFrom: number } | undefined
  tail: { tailFrom: number } | undefined
}

const hashAt = async (args: {
  plane: FollowPlane
  threadId: string
  seq: number
}): Promise<string | undefined> => {
  if (args.seq === 0) return GENESIS_HASH
  const cursor = await args.plane.readEventCursor({ threadId: args.threadId, seq: args.seq })
  return cursor?.hash
}

const tailFromOf = (headSeq: number): { tailFrom: number } => ({
  tailFrom: headSeq - STREAM_TAIL_EVENTS + 1,
})

export const resolveStart = async (args: {
  plane: FollowPlane
  threadId: string
  request: StartRequest
  isMainThread: boolean
  onHead?: ((seq: number) => void) | undefined
}): Promise<StartPosition> => {
  const { plane, threadId, request } = args
  const head = await plane.head({ threadId })
  args.onHead?.(head.seq)
  const reset = (reason: EStreamResetReason, tailFrom = 0): StartPosition => ({
    cursor: 0,
    reset: { reason, tailFrom },
    tail: undefined,
  })
  const { afterSeq, afterHash } = request
  const optedIn = args.isMainThread && request.tailViewVersion === SESSION_VIEW_VERSION
  const tooFarBehind = (from: number): boolean => head.seq - from > STREAM_TOO_FAR_BEHIND_EVENTS
  if (afterSeq === undefined)
    return optedIn && head.seq > STREAM_TAIL_EVENTS
      ? { cursor: 0, reset: undefined, tail: tailFromOf(head.seq) }
      : { cursor: 0, reset: undefined, tail: undefined }
  if (afterSeq > head.seq) return reset(EStreamResetReason.Ahead)
  if (afterHash !== undefined && (await hashAt({ plane, threadId, seq: afterSeq })) !== afterHash) {
    return reset(EStreamResetReason.Fork)
  }
  if (!optedIn || !tooFarBehind(afterSeq)) {
    return { cursor: afterSeq, reset: undefined, tail: undefined }
  }
  const tail = tailFromOf(head.seq)
  return { cursor: 0, reset: { reason: EStreamResetReason.TooFarBehind, ...tail }, tail }
}
