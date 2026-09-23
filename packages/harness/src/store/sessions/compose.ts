import { join } from 'node:path'

import { EForkMode, type ThreadId } from '@dltech/atlas-core'

import { readMetaSync, threadMetaSchema } from './meta'
import { sessionsDirectory, threadMetaFile } from './paths'

const REFERENCE_CHAIN_LIMIT = 8

export class ForkChainTooDeep extends Error {
  constructor({ threadId, limit }: { threadId: ThreadId; limit: number }) {
    super(
      `reading ${threadId} walked more than ${limit} reference forks, which is either a cycle or a nesting depth Atlas does not support`,
    )
    this.name = 'ForkChainTooDeep'
  }
}

export type Segment = {
  threadId: ThreadId
  sessionDir: string
  upTo: number | undefined
}

export function planSegments({
  home,
  sessionDir,
  threadId,
  upTo,
}: {
  home: string
  sessionDir: string
  threadId: ThreadId
  upTo?: number | undefined
}): Segment[] {
  const segments: Segment[] = []
  let segment: Segment = { threadId, sessionDir, upTo }

  for (let hop = 0; hop < REFERENCE_CHAIN_LIMIT; hop += 1) {
    segments.unshift(segment)

    const meta = readMetaSync({
      file: threadMetaFile({ sessionDir: segment.sessionDir, threadId: segment.threadId }),
      schema: threadMetaSchema,
    })
    if (meta === undefined) return segments
    if (meta.forkMode !== EForkMode.Reference) return segments
    if (meta.parentThreadId === null || meta.forkSeq === null) return segments

    const parentThreadId = meta.parentThreadId as ThreadId
    segment = {
      threadId: parentThreadId,
      sessionDir: join(sessionsDirectory({ home }), parentThreadId),
      upTo: segment.upTo === undefined ? meta.forkSeq : Math.min(segment.upTo, meta.forkSeq),
    }
  }

  throw new ForkChainTooDeep({ threadId, limit: REFERENCE_CHAIN_LIMIT })
}
