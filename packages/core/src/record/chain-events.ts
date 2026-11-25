import type { EventId, RunId, ThreadId } from '../events/ids'
import { GENESIS_HASH, chainHash, type LogHead } from './chain'
import type { RecordEventBody, RecordEvent } from './event'

export type ChainEventsParams = {
  threadId: ThreadId
  runId: RunId
  epoch: number
  bodies: readonly RecordEventBody[]
  from?: LogHead | undefined
  at: string
}

export function chainEvents(params: ChainEventsParams): RecordEvent[] {
  let head: LogHead = params.from ?? { seq: 0, hash: GENESIS_HASH }
  const events: RecordEvent[] = []
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
    } as RecordEvent
    events.push(event)
    head = { seq, hash: chainHash(event) }
  }
  return events
}
