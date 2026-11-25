import { COMMAND_OUTCOME_EVENT_TYPES, producesOutcome } from '../command-entries'
import { EInputConsumed, type RecordEvent } from '../event'
import { commandInputName } from '../input-events'

export type CommandFact = { inboxId: number; name: string; at: string }

export type CommandFacts = {
  postedCommands: Readonly<Record<string, CommandFact>>
  openCommands: readonly CommandFact[]
}

export const NO_COMMANDS: CommandFacts = { postedCommands: {}, openCommands: [] }

const keyOf = (inboxId: number): string => String(inboxId)

const namedOf = (event: RecordEvent): { inboxId: number; name: string } | undefined => {
  if (event.type !== 'input-posted') return undefined
  const name = commandInputName(event.kind)
  return name === undefined ? undefined : { inboxId: event.inboxId, name }
}

const withoutPosted = (facts: CommandFacts, inboxId: number): CommandFacts => {
  const key = keyOf(inboxId)
  if (!Object.hasOwn(facts.postedCommands, key)) return facts
  const kept = Object.entries(facts.postedCommands).filter(([entryKey]) => entryKey !== key)
  return { ...facts, postedCommands: Object.fromEntries(kept) }
}

const openedOf = (
  facts: CommandFacts,
  event: Extract<RecordEvent, { type: 'input-consumed' }>,
): CommandFacts => {
  const name = facts.postedCommands[keyOf(event.inboxId)]?.name ?? event.command?.name
  const posted = withoutPosted(facts, event.inboxId)
  if (name === undefined || !producesOutcome(name)) return posted
  const open = { inboxId: event.inboxId, name, at: event.at }
  return { ...posted, openCommands: [...posted.openCommands, open] }
}

const closedOf = (facts: CommandFacts, inboxId: number | undefined): CommandFacts => {
  const openCommands = facts.openCommands.filter(
    (command) => inboxId !== undefined && command.inboxId !== inboxId,
  )
  return openCommands.length === facts.openCommands.length ? facts : { ...facts, openCommands }
}

export const stepCommandFacts = (facts: CommandFacts, event: RecordEvent): CommandFacts => {
  const named = namedOf(event)
  if (named !== undefined) {
    const posted = { inboxId: named.inboxId, name: named.name, at: event.at }
    return { ...facts, postedCommands: { ...facts.postedCommands, [keyOf(named.inboxId)]: posted } }
  }
  if (event.type === 'input-consumed') {
    return event.consumed === EInputConsumed.Command ? openedOf(facts, event) : facts
  }
  if (event.type === 'input-refused' || event.type === 'input-withdrawn') {
    return closedOf(withoutPosted(facts, event.inboxId), event.inboxId)
  }
  if (!COMMAND_OUTCOME_EVENT_TYPES.has(event.type)) return facts
  return closedOf(facts, 'inboxId' in event ? event.inboxId : undefined)
}
