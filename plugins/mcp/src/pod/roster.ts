import {
  EMcpViewStatus,
  sameMcpRow,
  type McpServerChanged,
  type McpServerRemoved,
  type McpServerRow,
} from '../core'
import type { McpServerTools, McpToolsSnapshot } from './snapshot'

const viewStatusOf = (server: McpServerTools): EMcpViewStatus => {
  if (server.status === 'connected') return EMcpViewStatus.Connected
  if (server.status === 'needs-auth') return EMcpViewStatus.NeedsAuth
  if (server.status === 'unavailable') return EMcpViewStatus.Unavailable
  return EMcpViewStatus.Failed
}

export const rowsOf = (snapshot: McpToolsSnapshot | undefined): readonly McpServerRow[] =>
  (snapshot?.servers ?? []).map((server) => ({
    name: server.name,
    transport: server.transportKind,
    status: viewStatusOf(server),
    toolCount: server.tools.length,
    ...(server.reason === undefined ? {} : { reason: server.reason }),
    layer: server.origin,
  }))

export const mcpRosterDraftsOf = (args: {
  previous: readonly McpServerRow[]
  next: readonly McpServerRow[]
}): readonly (McpServerChanged | McpServerRemoved)[] => {
  const kept = new Map(args.previous.map((row) => [row.name, row]))
  const changed: McpServerChanged[] = args.next
    .filter((row) => {
      const was = kept.get(row.name)
      return was === undefined || !sameMcpRow(was, row)
    })
    .map((row) => ({ type: 'mcp-server-changed', row }))
  const removed = [...kept.keys()]
    .filter((name) => !args.next.some((row) => row.name === name))
    .map((name): McpServerRemoved => ({ type: 'mcp-server-removed', name }))
  return [...changed, ...removed]
}
