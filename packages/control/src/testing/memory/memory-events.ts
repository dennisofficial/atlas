import { SeqConflictError, type ReadEventsParams, type StoredEvent } from '../../port'
import { bisectAfter } from './memory-helpers'
import type { State } from './memory-state'

export const insertEventsIn = (params: { state: State; rows: readonly StoredEvent[] }): void => {
  for (const row of params.rows) {
    const log = params.state.events.get(row.threadId)
    const last = log?.[log.length - 1]
    if (log === undefined || params.state.eventIds.has(row.id) || (last && last.seq >= row.seq)) {
      throw new SeqConflictError()
    }
    log.push(row)
    params.state.eventIds.add(row.id)
  }
}

export const readEventsIn = (params: { state: State } & ReadEventsParams): StoredEvent[] => {
  const log = params.state.events.get(params.threadId) ?? []
  const out: StoredEvent[] = []
  for (
    let index = bisectAfter({ rows: log, afterSeq: params.afterSeq });
    index < log.length;
    index += 1
  ) {
    const row = log[index] as StoredEvent
    if (row.seq > params.throughSeq || out.length >= params.limit) break
    if (params.onlyTypes === undefined || params.onlyTypes.includes(row.type)) out.push(row)
  }
  return out
}
