import { EMcpScope, PROJECT_MCP_ROWS, type McpServer } from '../settings/fixtures/settings-mcp'
import { EMcpDialog, McpView } from '../shared/mcp/mcp-view'

export function McpPage({
  initialRows = PROJECT_MCP_ROWS,
  openDialog = EMcpDialog.None,
  initialJson = '',
}: {
  initialRows?: McpServer[]
  openDialog?: EMcpDialog
  initialJson?: string
}) {
  return (
    <McpView
      scope={EMcpScope.Project}
      initialRows={initialRows}
      description="Tools every thread in this project can call, alongside your personal ones."
      openDialog={openDialog}
      initialJson={initialJson}
    />
  )
}
