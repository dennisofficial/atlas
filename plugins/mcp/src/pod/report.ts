import { EMcpViewStatus, type McpServerRow } from '../core'

export const NO_MCP_SERVERS = 'no MCP servers are configured'

const labelOf = (status: EMcpViewStatus): string => {
  if (status === EMcpViewStatus.Connected) return 'Connected'
  if (status === EMcpViewStatus.Disabled) return 'Disabled'
  if (status === EMcpViewStatus.NeedsAuth) return 'NeedsAuth'
  return 'Failed'
}

const toolCountOf = (count: number): string => `${count} tool${count === 1 ? '' : 's'}`

export const mcpReportRow = (row: McpServerRow): string => {
  const head = `${row.name} ${labelOf(row.status)} ${toolCountOf(row.toolCount)} ${row.layer}`
  return row.reason === undefined || row.reason === '' ? head : `${head}: ${row.reason}`
}

export const mcpReport = (rows: readonly McpServerRow[]): string =>
  rows.length === 0 ? NO_MCP_SERVERS : rows.map(mcpReportRow).join('\n')
