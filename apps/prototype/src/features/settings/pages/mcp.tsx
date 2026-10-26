import { EMcpScope, PERSONAL_MCP_SERVERS, type McpServer } from '../fixtures/settings-mcp'
import { EMcpDialog, McpView } from '../../shared/mcp/mcp-view'

export function McpPage({
  initial = PERSONAL_MCP_SERVERS,
  openDialog = EMcpDialog.None,
  initialJson = '',
}: {
  initial?: McpServer[]
  openDialog?: EMcpDialog
  initialJson?: string
}) {
  return (
    <McpView
      scope={EMcpScope.Personal}
      initialRows={initial}
      description="Tools every thread you start can call. A project's servers override yours."
      openDialog={openDialog}
      initialJson={initialJson}
    />
  )
}
