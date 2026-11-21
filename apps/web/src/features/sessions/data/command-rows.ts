import { ECommandState, type SessionCommandRow } from '@dltech/atlas-protocol'

type CommandWords = Readonly<{ running: string; afterTurn?: string }>

const COMMAND_WORDS: Readonly<Record<string, CommandWords>> = {
  rewind: { running: 'Rewinding…', afterTurn: 'Rewind after this turn' },
  summarise: { running: 'Summarising…', afterTurn: 'Summarise after this turn' },
  rename: { running: 'Renaming…' },
  subscribe: { running: 'Subscribing…' },
  unsubscribe: { running: 'Unsubscribing…' },
  mcp: { running: 'Listing MCP servers…' },
}

const titleCased = (word: string): string => `${word.charAt(0).toUpperCase()}${word.slice(1)}`

export const humanizedCommandName = (name: string): string =>
  name
    .split('-')
    .filter((word) => word.length > 0)
    .map((word, index) => (index === 0 ? titleCased(word) : word))
    .join(' ')

const runningLabelOf = (name: string): string =>
  COMMAND_WORDS[name]?.running ?? `Running ${humanizedCommandName(name)}…`

export const commandRowLabelOf = (row: Pick<SessionCommandRow, 'name' | 'state'>): string => {
  const afterTurn =
    row.state === ECommandState.Queued ? COMMAND_WORDS[row.name]?.afterTurn : undefined
  return afterTurn ?? runningLabelOf(row.name)
}
