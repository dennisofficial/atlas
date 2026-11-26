import { SUPERSEDED_BY, type RecordEvent } from '@dltech/atlas-core'
import type { z } from 'zod'

import type { ControlTx } from './port'
import { decodeStoredEvent } from './stored-event'

type SupersededType = keyof typeof SUPERSEDED_BY

const isSupersededType = (type: string): type is SupersededType =>
  Object.hasOwn(SUPERSEDED_BY, type)

const firstAfterIn = async (args: {
  tx: ControlTx
  threadId: string
  afterSeq: number
  throughSeq: number
  onlyTypes: readonly string[]
  eventSchema?: z.ZodType<RecordEvent> | undefined
}): Promise<RecordEvent | undefined> => {
  const [row] = await args.tx.readEvents({
    threadId: args.threadId,
    afterSeq: args.afterSeq,
    throughSeq: args.throughSeq,
    limit: 1,
    onlyTypes: args.onlyTypes,
  })
  return row === undefined ? undefined : decodeStoredEvent(row, args.eventSchema)
}

export const supersedingEventsIn = async (args: {
  tx: ControlTx
  threadId: string
  throughSeq: number
  candidates: readonly RecordEvent[]
  eventSchema?: z.ZodType<RecordEvent> | undefined
}): Promise<RecordEvent[]> => {
  const found: RecordEvent[] = []
  for (const type of Object.keys(SUPERSEDED_BY).filter(isSupersededType)) {
    const superseded = args.candidates.filter((event) => event.type === type)
    let next: RecordEvent | undefined = superseded[0]
    while (next !== undefined) {
      const closer = await firstAfterIn({
        ...args,
        afterSeq: next.seq,
        onlyTypes: SUPERSEDED_BY[type],
      })
      if (closer === undefined) break
      found.push(closer)
      next = superseded.find((event) => event.seq > closer.seq)
    }
  }
  return found
}
