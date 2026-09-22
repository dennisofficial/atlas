import { BadRequestException } from '@nestjs/common'
import type { Prisma, PrismaClient } from '../../../generated/prisma/client'

export const REFERENCE_CHAIN_LIMIT = 8

export type SessionReader = Pick<PrismaClient, 'thread' | 'event'> | Prisma.TransactionClient

export type Segment = { threadId: string; upTo: number | undefined }

export async function planSegments(args: {
  reader: SessionReader
  threadId: string
  upTo?: number | undefined
}): Promise<Segment[]> {
  const segments: Segment[] = []
  let segment: Segment = { threadId: args.threadId, upTo: args.upTo }

  for (let hop = 0; hop < REFERENCE_CHAIN_LIMIT; hop += 1) {
    segments.unshift(segment)

    const inherited = await inheritedPrefixOf({ reader: args.reader, threadId: segment.threadId })
    if (inherited === undefined) return segments

    segment = {
      threadId: inherited.threadId,
      upTo:
        segment.upTo === undefined ? inherited.forkSeq : Math.min(segment.upTo, inherited.forkSeq),
    }
  }

  throw new BadRequestException(
    `reading ${args.threadId} walked more than ${REFERENCE_CHAIN_LIMIT} reference forks, which is either a cycle or a nesting depth Atlas does not support`,
  )
}

async function inheritedPrefixOf(args: {
  reader: SessionReader
  threadId: string
}): Promise<{ threadId: string; forkSeq: number } | undefined> {
  const link = await args.reader.thread.findUnique({
    where: { id: args.threadId },
    select: { parentThreadId: true, forkSeq: true, forkMode: true },
  })
  if (link === null) return undefined
  if (link.forkMode !== 'reference') return undefined
  if (link.parentThreadId === null || link.forkSeq === null) return undefined
  return { threadId: link.parentThreadId, forkSeq: link.forkSeq }
}
