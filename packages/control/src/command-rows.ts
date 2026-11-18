import { commandInputName, EInputConsumed, type V2Event } from '@dltech/atlas-core'
import {
  ECommandState,
  QUEUED_MESSAGES_LIMIT,
  type SessionCommandRow,
} from '@dltech/atlas-protocol'

import type { z } from 'zod'

import type { ControlTx } from './port'
import { readEventsIn } from './read-events'
import { VIEW_TAIL_LIMIT } from './session-view-ops'

type CommandOutcomeEvent = {
  type: string
  seq: number
  inboxId?: number | undefined
  consumed?: EInputConsumed | undefined
}

export const unfinishedCommandIdsOf = (events: readonly CommandOutcomeEvent[]): number[] => {
  const finished = new Set<number>()
  let unnamedOutcomeSeq = 0
  for (const event of events) {
    if (event.type === 'input-refused' && event.inboxId !== undefined) finished.add(event.inboxId)
    if (event.type !== 'history-rewound' && event.type !== 'history-summarised') continue
    if (event.inboxId === undefined) unnamedOutcomeSeq = event.seq
    else finished.add(event.inboxId)
  }
  return events.flatMap((event) =>
    event.type === 'input-consumed' &&
    event.inboxId !== undefined &&
    event.consumed === EInputConsumed.Command &&
    event.seq > unnamedOutcomeSeq &&
    !finished.has(event.inboxId)
      ? [event.inboxId]
      : [],
  )
}

export const runningCommandsIn = async (args: {
  tx: ControlTx
  sessionId: string
  threadId: string
  eventSchema?: z.ZodType<V2Event> | undefined
}): Promise<SessionCommandRow[]> => {
  const { tx } = args
  const row = await tx.readThread(args.threadId)
  if (row === undefined) return []
  const tail = await readEventsIn({
    tx,
    row,
    afterSeq: Math.max(0, row.headSeq - VIEW_TAIL_LIMIT),
    limit: VIEW_TAIL_LIMIT,
    visible: true,
    eventSchema: args.eventSchema,
  })
  const posted = new Map<number, { name: string; postedAt: string }>()
  for (const event of tail.events) {
    if (event.type !== 'input-posted') continue
    const name = commandInputName(event.kind)
    if (name !== undefined) posted.set(event.inboxId, { name, postedAt: event.postedAt })
  }
  const rows: SessionCommandRow[] = []
  for (const inboxId of unfinishedCommandIdsOf(tail.events)) {
    const kept = posted.get(inboxId)
    if (kept === undefined) continue
    rows.push({ inboxId, name: kept.name, postedAt: kept.postedAt, state: ECommandState.Running })
  }
  return rows.slice(0, QUEUED_MESSAGES_LIMIT)
}
