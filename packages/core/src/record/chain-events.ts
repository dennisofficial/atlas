import type { EventId, RunId, ThreadId } from '../events/ids'
import { GENESIS_HASH, chainHash, type LogHead } from './chain'
import type { V2Body, V2Event } from './event'

export type ChainEventsParams = {
  threadId: ThreadId
  runId: RunId
  epoch: number
  bodies: readonly V2Body[]
  from?: LogHead | undefined
  at: string
}

export function chainEvents(params: ChainEventsParams): V2Event[] {
  let head: LogHead = params.from ?? { seq: 0, hash: GENESIS_HASH }
  const events: V2Event[] = []
  for (const body of params.bodies) {
    const seq = head.seq + 1
    const event = {
      ...body,
      id: `${params.threadId}:${seq}` as EventId,
      seq,
      threadId: params.threadId,
      runId: params.runId,
      depth: 0,
      at: params.at,
      epoch: params.epoch,
      prevHash: head.hash,
    } as V2Event
    events.push(event)
    head = { seq, hash: chainHash(event) }
  }
  return events
}
