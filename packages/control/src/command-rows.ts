import {
  commandInputName,
  unfinishedCommandIdsOf,
  type V2Event,
  type V2EventType,
} from '@dltech/atlas-core'
import {
  ECommandState,
  QUEUED_MESSAGES_LIMIT,
  type SessionCommandRow,
} from '@dltech/atlas-protocol'

import type { z } from 'zod'

import type { ControlTx } from './port'
import { readEventsIn } from './read-events'
import { VIEW_TAIL_LIMIT } from './session-view-ops'

export { unfinishedCommandIdsOf } from '@dltech/atlas-core'

export const COMMAND_TAIL_TYPES: readonly V2EventType[] = [
  'input-posted',
  'input-consumed',
  'input-refused',
  'command-applied',
  'history-rewound',
  'history-summarised',
  'rotated',
  'resume-marked',
]

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
    onlyTypes: COMMAND_TAIL_TYPES,
    eventSchema: args.eventSchema,
  })
  const posted = new Map<number, { name: string; postedAt: string }>()
  for (const event of tail.events) {
    if (event.type !== 'input-posted') continue
    const name = commandInputName(event.kind)
    if (name !== undefined) posted.set(event.inboxId, { name, postedAt: event.postedAt })
  }
  for (const event of tail.events) {
    if (event.type !== 'input-consumed' || event.command === undefined) continue
    const at = posted.get(event.inboxId)?.postedAt ?? event.at
    posted.set(event.inboxId, { name: event.command.name, postedAt: at })
  }
  const rows: SessionCommandRow[] = []
  for (const inboxId of unfinishedCommandIdsOf(tail.events)) {
    const kept = posted.get(inboxId)
    if (kept === undefined) continue
    rows.push({ inboxId, name: kept.name, postedAt: kept.postedAt, state: ECommandState.Running })
  }
  return rows.slice(0, QUEUED_MESSAGES_LIMIT)
}
