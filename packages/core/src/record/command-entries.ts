import { EInputConsumed, ERewindCause, type ConsumedCommand, type V2Event } from './event'
import { commandInputName } from './input-events'
import type { PendingInputsState } from './pending-inputs'

export type CommandEntry = { inboxId: number; name: string; postedAt: string }

export const commandEntriesOf = (state: PendingInputsState): readonly CommandEntry[] =>
  state.pending.flatMap((entry) => {
    const name = commandInputName(entry.kind)
    return name === undefined ? [] : [{ inboxId: entry.inboxId, name, postedAt: entry.at }]
  })

export const COMMAND_OUTCOMES: Readonly<Record<string, readonly string[]>> = {
  rewind: ['history-rewound'],
  summarise: ['history-summarised'],
  rotate: ['rotated'],
  resume: ['resume-marked'],
  agent: ['command-applied'],
  'shell-kill': ['command-applied'],
  service: ['command-applied'],
}

export const COMMAND_OUTCOME_EVENT_TYPES: ReadonlySet<string> = new Set(
  Object.values(COMMAND_OUTCOMES).flat(),
)

export const producesOutcome = (name: string | undefined): boolean =>
  name === undefined || COMMAND_OUTCOMES[name] !== undefined

export type CommandOutcomeEvent = {
  type: string
  seq: number
  inboxId?: number | undefined
  kind?: string | undefined
  consumed?: EInputConsumed | undefined
  command?: ConsumedCommand | string | undefined
  cause?: string | undefined
}

export const unfinishedCommandIdsOf = (
  events: readonly CommandOutcomeEvent[],
): readonly number[] => {
  const names = new Map<number, string>()
  for (const event of events) {
    if (event.inboxId === undefined) continue
    if (event.type === 'input-posted') {
      if (event.kind === undefined) continue
      const name = commandInputName(event.kind)
      if (name !== undefined) names.set(event.inboxId, name)
      continue
    }
    if (event.type === 'input-consumed' && typeof event.command === 'object') {
      names.set(event.inboxId, event.command.name)
    }
  }
  const finished = new Set<number>()
  let unnamedOutcomeSeq = 0
  for (const event of events) {
    if (event.type === 'input-refused') {
      if (event.inboxId !== undefined) finished.add(event.inboxId)
      continue
    }
    if (event.type === 'history-rewound' && event.cause === ERewindCause.QuickStop) continue
    if (!COMMAND_OUTCOME_EVENT_TYPES.has(event.type)) continue
    if (event.inboxId === undefined) unnamedOutcomeSeq = event.seq
    else finished.add(event.inboxId)
  }
  return events.flatMap((event) =>
    event.type === 'input-consumed' &&
    event.inboxId !== undefined &&
    event.consumed === EInputConsumed.Command &&
    event.seq > unnamedOutcomeSeq &&
    !finished.has(event.inboxId) &&
    producesOutcome(names.get(event.inboxId))
      ? [event.inboxId]
      : [],
  )
}

export const COMMAND_LOG_TYPES: ReadonlySet<string> = new Set([
  'input-posted',
  'input-consumed',
  'input-refused',
  'history-rewound',
  'history-summarised',
  'rotated',
  'resume-marked',
])

export const isCommandLogEvent = (event: V2Event): boolean => COMMAND_LOG_TYPES.has(event.type)

export const commandLogOf = (events: readonly V2Event[]): readonly V2Event[] =>
  events.filter(isCommandLogEvent)

export const runningCommandEntriesOf = (events: readonly V2Event[]): readonly CommandEntry[] => {
  const postedAt = new Map<number, string>()
  const posted = new Map<number, CommandEntry>()
  for (const event of events) {
    if (event.type !== 'input-posted') continue
    postedAt.set(event.inboxId, event.postedAt)
    const name = commandInputName(event.kind)
    if (name !== undefined) {
      posted.set(event.inboxId, { inboxId: event.inboxId, name, postedAt: event.postedAt })
    }
  }
  for (const event of events) {
    if (event.type !== 'input-consumed' || event.command === undefined) continue
    const at = postedAt.get(event.inboxId) ?? event.at
    posted.set(event.inboxId, { inboxId: event.inboxId, name: event.command.name, postedAt: at })
  }
  return unfinishedCommandIdsOf(events).flatMap((inboxId) => {
    const entry = posted.get(inboxId)
    return entry === undefined ? [] : [entry]
  })
}
