import type { CommandEntry } from '@dltech/atlas-commands'

import { COMMAND_MENU_ROWS } from '../ui/command-menu-model'
import { menuWindow, movedIndex } from '../ui/menu-model'

export type SlashMenuState = { query: string; index: number; rows: readonly CommandEntry[] }

const ZONE = /(?:^|\s)\/([a-zA-Z0-9-]*)$/

const firstLineOf = (text: string): string => text.split('\n')[0] ?? ''

const queryOf = (text: string): { query: string; at: number } | null => {
  const line = firstLineOf(text)
  const match = ZONE.exec(line)
  if (match === null) return null
  const query = match[1]
  if (query === undefined) return null
  return { query, at: match.index + (match[0].length - query.length - 1) }
}

const matchesOf = (args: {
  query: string
  entries: readonly CommandEntry[]
}): readonly CommandEntry[] => {
  const needle = args.query.toLowerCase()
  if (needle === '') return args.entries

  const prefix = args.entries.filter((entry) => entry.name.toLowerCase().startsWith(needle))
  const rest = args.entries.filter(
    (entry) => !prefix.includes(entry) && entry.summary.toLowerCase().includes(needle),
  )
  return [...prefix, ...rest]
}

export const openSlashMenu = (args: {
  text: string
  entries: readonly CommandEntry[]
}): SlashMenuState | null => {
  const zone = queryOf(args.text)
  if (zone === null) return null

  const rows = matchesOf({ query: zone.query, entries: args.entries })
  if (rows.length === 0) return null

  return { query: zone.query, index: 0, rows }
}

export const moveSlashSelection = (args: {
  state: SlashMenuState
  delta: number
}): SlashMenuState => {
  const index = movedIndex({
    index: args.state.index,
    count: args.state.rows.length,
    delta: args.delta,
  })

  return index === args.state.index ? args.state : { ...args.state, index }
}

export const selectedSlashEntry = (state: SlashMenuState): CommandEntry | null =>
  state.rows[state.index] ?? null

export const completedSlashText = (args: { text: string; entry: CommandEntry }): string => {
  const zone = queryOf(args.text)
  if (zone === null) return args.text

  const lines = args.text.split('\n')
  const line = lines[0] ?? ''
  const head = line.slice(0, zone.at)
  return [`${head}/${args.entry.name} `, ...lines.slice(1)].join('\n')
}

export const slashMenuWindow = (args: {
  state: SlashMenuState
  rows: number
}): { start: number; visible: readonly CommandEntry[] } => {
  const window = menuWindow({
    entries: args.state.rows,
    index: args.state.index,
    rows: args.rows,
  })

  return { start: window.start, visible: window.visible }
}

export const SLASH_MENU_ROWS = COMMAND_MENU_ROWS
