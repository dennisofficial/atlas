import { EInputConsumed, type V2Event } from './event'
import { commandInputName } from './input-events'
import type { PendingInputsState } from './pending-inputs'

export type CommandEntry = { inboxId: number; name: string; postedAt: string }

export const commandEntriesOf = (state: PendingInputsState): readonly CommandEntry[] =>
  state.pending.flatMap((entry) => {
    const name = commandInputName(entry.kind)
    return name === undefined ? [] : [{ inboxId: entry.inboxId, name, postedAt: entry.at }]
  })

export type CommandOutcomeEvent = {
  type: string
  seq: number
  inboxId?: number | undefined
  consumed?: EInputConsumed | undefined
}

export const unfinishedCommandIdsOf = (
  events: readonly CommandOutcomeEvent[],
): readonly number[] => {
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

const COMMAND_LOG_TYPES: ReadonlySet<string> = new Set([
  'input-posted',
  'input-consumed',
  'input-refused',
  'history-rewound',
  'history-summarised',
])

export const isCommandLogEvent = (event: V2Event): boolean => COMMAND_LOG_TYPES.has(event.type)

export const commandLogOf = (events: readonly V2Event[]): readonly V2Event[] =>
  events.filter(isCommandLogEvent)

export const runningCommandEntriesOf = (events: readonly V2Event[]): readonly CommandEntry[] => {
  const posted = new Map<number, CommandEntry>()
  for (const event of events) {
    if (event.type !== 'input-posted') continue
    const name = commandInputName(event.kind)
    if (name === undefined) continue
    posted.set(event.inboxId, { inboxId: event.inboxId, name, postedAt: event.postedAt })
  }
  return unfinishedCommandIdsOf(events).flatMap((inboxId) => {
    const entry = posted.get(inboxId)
    return entry === undefined ? [] : [entry]
  })
}
