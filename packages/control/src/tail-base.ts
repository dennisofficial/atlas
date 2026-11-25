import {
  COMMAND_LOG_TYPES,
  DURABLE_TYPES,
  type PluginViewFold,
  type SessionViewState,
  type RecordEvent,
  type VisibilityState,
} from '@dltech/atlas-core'
import type { z } from 'zod'

import type { ControlTx } from './port'
import { currentViewIn } from './session-view-read'
import { decodeStoredEvent, decodeVisibility } from './stored-event'

export const TAIL_BASE_ATTEMPTS = 3

const TAIL_BASE_PAGE = 500

export type TailBase = {
  cursor: { seq: number; hash: string }
  view: SessionViewState
  visibility: VisibilityState
  durable: RecordEvent[]
  commandLog: RecordEvent[]
}

const typedEventsIn = async (args: {
  tx: ControlTx
  threadId: string
  throughSeq: number
  onlyTypes: readonly string[]
  eventSchema?: z.ZodType<RecordEvent> | undefined
}): Promise<RecordEvent[]> => {
  const events: RecordEvent[] = []
  let afterSeq = 0
  for (;;) {
    const rows = await args.tx.readEvents({
      threadId: args.threadId,
      afterSeq,
      throughSeq: args.throughSeq,
      limit: TAIL_BASE_PAGE,
      onlyTypes: args.onlyTypes,
    })
    events.push(...rows.map((row) => decodeStoredEvent(row, args.eventSchema)))
    const last = rows[rows.length - 1]
    if (last === undefined || rows.length < TAIL_BASE_PAGE) return events
    afterSeq = last.seq
  }
}

const cursorBeforeIn = async (args: {
  tx: ControlTx
  threadId: string
  tailFrom: number
}): Promise<TailBase['cursor'] | undefined> => {
  const seq = args.tailFrom - 1
  const rows = await args.tx.readEvents({
    threadId: args.threadId,
    afterSeq: seq - 1,
    throughSeq: seq,
    limit: 1,
  })
  const row = rows[0]
  return row === undefined || row.seq !== seq ? undefined : { seq: row.seq, hash: row.hash }
}

export const readTailBaseIn = async (args: {
  tx: ControlTx
  sessionId: string
  threadId: string
  tailFrom: number
  eventSchema?: z.ZodType<RecordEvent> | undefined
  pluginViews?: readonly PluginViewFold[] | undefined
}): Promise<TailBase | undefined> => {
  const { tx, threadId } = args
  if (args.tailFrom < 2) return undefined
  const view = await currentViewIn({
    tx,
    sessionId: args.sessionId,
    threadId,
    eventSchema: args.eventSchema,
    pluginViews: args.pluginViews,
  })
  const row = await tx.readThread(threadId)
  if (row === undefined || row.headSeq !== view.at) return undefined
  const cursor = await cursorBeforeIn({ tx, threadId, tailFrom: args.tailFrom })
  if (cursor === undefined) return undefined
  const throughSeq = args.tailFrom - 1
  return {
    cursor,
    view,
    visibility: decodeVisibility(row.visibility),
    durable: await typedEventsIn({
      tx,
      threadId,
      throughSeq,
      onlyTypes: DURABLE_TYPES,
      eventSchema: args.eventSchema,
    }),
    commandLog: await typedEventsIn({
      tx,
      threadId,
      throughSeq,
      onlyTypes: [...COMMAND_LOG_TYPES],
      eventSchema: args.eventSchema,
    }),
  }
}
