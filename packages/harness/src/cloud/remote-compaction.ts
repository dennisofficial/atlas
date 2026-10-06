import { randomUUID } from 'node:crypto'

import { ECompactionAnchor, type ThreadId } from '@dltech/atlas-core'
import {
  cancelCompactionParamsSchema,
  compactHistoryParamsSchema,
  compactionReplySchema,
  EWireCompactionAnchor,
  EWireCompactScope,
  summariseHistoryParamsSchema,
  type CompactionReply,
} from '@dltech/atlas-wire'

import { ECompaction, ECompactScope, type Compaction } from '../composition/compact-turn'
import { CompactionPort } from '../store/compaction-port'
import { EClientRequest } from './channel-wire'
import type { RemoteDeltaChannel } from './remote-delta-channel'

export const compactScopeToWire = (scope: ECompactScope): EWireCompactScope =>
  scope === ECompactScope.Everything ? EWireCompactScope.Everything : EWireCompactScope.Recent

export const compactScopeFromWire = (scope: EWireCompactScope): ECompactScope =>
  scope === EWireCompactScope.Everything ? ECompactScope.Everything : ECompactScope.Recent

export const compactionAnchorToWire = (anchor: ECompactionAnchor): EWireCompactionAnchor =>
  anchor === ECompactionAnchor.Suffix ? EWireCompactionAnchor.Suffix : EWireCompactionAnchor.Prefix

export const compactionAnchorFromWire = (anchor: EWireCompactionAnchor): ECompactionAnchor =>
  anchor === EWireCompactionAnchor.Suffix ? ECompactionAnchor.Suffix : ECompactionAnchor.Prefix

export const compactionFromReply = (reply: CompactionReply): Compaction => {
  if (reply.type === 'compacted') {
    return {
      type: ECompaction.Compacted,
      replaced: reply.replaced,
      fromSeq: reply.fromSeq,
      throughSeq: reply.throughSeq,
    }
  }
  if (reply.type === 'refused') return { type: ECompaction.Refused, reason: reply.reason }
  return { type: ECompaction.Nothing }
}

export const compactionToReply = (compaction: Compaction): CompactionReply => {
  if (compaction.type === ECompaction.Compacted) {
    return {
      type: 'compacted',
      replaced: compaction.replaced,
      fromSeq: compaction.fromSeq,
      throughSeq: compaction.throughSeq,
    }
  }
  if (compaction.type === ECompaction.Refused) {
    return { type: 'refused', reason: compaction.reason }
  }
  return { type: 'nothing' }
}

const abortedError = (signal: AbortSignal): Error =>
  signal.reason instanceof Error ? signal.reason : new Error('The compaction was cancelled.')

export class RemoteCompaction extends CompactionPort {
  private readonly channel: Pick<RemoteDeltaChannel, 'request'>

  constructor(args: { channel: Pick<RemoteDeltaChannel, 'request'> }) {
    super()
    this.channel = args.channel
  }

  compact(args: {
    threadId: ThreadId
    scope?: ECompactScope | undefined
    signal?: AbortSignal | undefined
  }): Promise<Compaction> {
    const operationId = randomUUID()
    return this.run({
      op: EClientRequest.CompactHistory,
      threadId: args.threadId,
      operationId,
      signal: args.signal,
      params: compactHistoryParamsSchema.parse({
        threadId: args.threadId,
        operationId,
        scope: compactScopeToWire(args.scope ?? ECompactScope.Recent),
      }),
    })
  }

  summarise(args: {
    threadId: ThreadId
    anchor: ECompactionAnchor
    seq: number
    signal?: AbortSignal | undefined
  }): Promise<Compaction> {
    const operationId = randomUUID()
    return this.run({
      op: EClientRequest.SummariseHistory,
      threadId: args.threadId,
      operationId,
      signal: args.signal,
      params: summariseHistoryParamsSchema.parse({
        threadId: args.threadId,
        operationId,
        anchor: compactionAnchorToWire(args.anchor),
        seq: args.seq,
      }),
    })
  }

  private async run(args: {
    op: EClientRequest
    threadId: ThreadId
    operationId: string
    signal: AbortSignal | undefined
    params: unknown
  }): Promise<Compaction> {
    const { signal } = args
    if (signal?.aborted === true) throw abortedError(signal)

    const handleAbort = (): void => {
      const params = cancelCompactionParamsSchema.parse({
        threadId: args.threadId,
        operationId: args.operationId,
      })
      this.channel.request({ op: EClientRequest.CancelCompaction, params }).catch(() => undefined)
    }
    signal?.addEventListener('abort', handleAbort, { once: true })

    try {
      const reply = await this.channel.request({ op: args.op, params: args.params })
      return compactionFromReply(compactionReplySchema.parse(reply))
    } finally {
      signal?.removeEventListener('abort', handleAbort)
    }
  }
}
