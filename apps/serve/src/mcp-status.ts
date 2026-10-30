import { EMcpServerStatus, type McpServerStatus } from '@dltech/atlas-harness'
import { EMcpServerWireStatus, type McpServerStatusWire } from '@dltech/atlas-wire'

const wireStatusOf = (server: McpServerStatus): EMcpServerWireStatus => {
  if (server.state.status === EMcpServerStatus.Connected) return EMcpServerWireStatus.Connected
  if (server.state.status === EMcpServerStatus.NeedsAuth) return EMcpServerWireStatus.NeedsAuth
  if (server.state.status === EMcpServerStatus.Disabled) return EMcpServerWireStatus.Disabled
  return EMcpServerWireStatus.Failed
}

export const mcpStatusWireOf = (server: McpServerStatus): McpServerStatusWire => {
  const transport = server.spec.transport
  return {
    name: server.spec.name,
    transport: transport?.kind ?? 'none',
    ...(transport?.kind === 'http' ? { url: transport.url } : {}),
    status: wireStatusOf(server),
    toolCount: server.tools,
    ...(server.state.status === EMcpServerStatus.Failed ? { reason: server.state.error } : {}),
  }
}
