import {
  chainHash,
  ETurnCause,
  isCommandLogEvent,
  isDurable,
  type RecordEventBody,
  type RecordEvent,
} from '@dltech/atlas-core'
import type { StreamServerMessage } from '@dltech/atlas-protocol'

import { applyPage, EMPTY_WINDOW, type SessionWindow } from '../session-window'
import { headOf, mintEvents } from './support'

export const AT = '2026-11-05T10:00:00.000Z'

export const TAIL_FROM = 21

export const TOTAL = 30

const said = (text: string): RecordEventBody => ({ type: 'user-said', text })

const bodies: RecordEventBody[] = Array.from({ length: TOTAL }, (_, index) => said(`m${index}`))

bodies[0] = { type: 'turn-started', turnId: 'turn-1', cause: ETurnCause.Input }
bodies[2] = { type: 'input-posted', inboxId: 7, kind: 'message', postedAt: AT }
bodies[9] = { type: 'history-rewound', toSeq: 4 }
bodies[24] = {
  type: 'assistant-said',
  parts: [{ type: 'text', text: 'hi' }],
  usage: { inputTokens: 100, outputTokens: 10, providerId: 'p', modelId: 'm' },
}

export const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export const pageOf = (events: readonly RecordEvent[]) => ({
  events: events.map((event) => plain(event)) as unknown[],
  head: headOf(events),
})

export const replayOf = (events: readonly RecordEvent[]): SessionWindow =>
  applyPage({ window: EMPTY_WINDOW, page: pageOf(events) })

export const tailBaseMessageOf = (args: {
  all: readonly RecordEvent[]
  full: SessionWindow
  tailFrom: number
}): StreamServerMessage => ({
  type: 'base',
  id: 's1',
  cursor: { seq: args.tailFrom - 1, hash: chainHash(args.all[args.tailFrom - 2] as RecordEvent) },
  visibility: plain(args.full.visibility),
  view: plain(args.full.view),
  durable: args.all
    .filter((event) => event.seq < args.tailFrom && isDurable(event.type))
    .map(plain),
  commandLog: args.all
    .filter((event) => event.seq < args.tailFrom && isCommandLogEvent(event))
    .map(plain),
})

export const tailLogOf = () => {
  const all = mintEvents({ bodies })
  const full = replayOf(all)
  const base = tailBaseMessageOf({ all, full, tailFrom: TAIL_FROM })
  return { all, full, base, tail: all.slice(TAIL_FROM - 1) }
}
