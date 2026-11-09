import type { Event, PluginViewFold, V2Event } from '@dltech/atlas-core'

import './roster-events'
import { mcpServerRowSchema, type McpServerRow } from './row'

export const MCP_VIEW = 'mcp'

export type McpRosterState = readonly McpServerRow[]

const upsert = (state: McpRosterState, row: McpServerRow): McpRosterState =>
  state.some((kept) => kept.name === row.name)
    ? state.map((kept) => (kept.name === row.name ? row : kept))
    : [...state, row]

export const foldMcpRoster = (state: McpRosterState, event: Event | V2Event): McpRosterState => {
  if (event.type === 'mcp-server-changed') {
    return upsert(state, mcpServerRowSchema.parse(event.row))
  }
  if (event.type === 'mcp-server-removed') {
    return state.filter((kept) => kept.name !== event.name)
  }
  return state
}

export const mcpRosterView: PluginViewFold<McpRosterState> = {
  name: MCP_VIEW,
  initial: [],
  fold: foldMcpRoster,
}

export const mcpRosterOfEvents = (events: readonly (Event | V2Event)[]): McpRosterState =>
  events.reduce(foldMcpRoster, mcpRosterView.initial)
