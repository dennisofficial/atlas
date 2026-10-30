import {
  EMcpServerWireStatus,
  listMcpServersReplySchema,
  type McpServerStatusWire,
} from '@dltech/atlas-wire/web'

export const NO_MCP_SERVERS_NOTICE = 'No MCP servers are configured'
export const MCP_SETTINGS_HINT = 'Sign in at Settings → Integrations'

const rowOf = (server: McpServerStatusWire): string => {
  const tools = `${server.toolCount} tool${server.toolCount === 1 ? '' : 's'}`
  const detail = server.reason === undefined ? '' : `: ${server.reason}`
  const hint = server.status === EMcpServerWireStatus.NeedsAuth ? ` — ${MCP_SETTINGS_HINT}` : ''
  return `${server.name} — ${server.status} (${tools})${detail}${hint}`
}

export const mcpNoticeOf = (reply: unknown): string => {
  const servers = listMcpServersReplySchema.parse(reply).servers
  return servers.length === 0 ? NO_MCP_SERVERS_NOTICE : servers.map(rowOf).join('\n')
}

export const isSignInArgument = (argumentText: string): boolean =>
  argumentText.trim().toLowerCase().split(/\s+/)[0] === 'signin'
