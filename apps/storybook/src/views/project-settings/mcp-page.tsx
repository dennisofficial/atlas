import { EMcpScope, PROJECT_MCP_ROWS, type McpServer } from '../../fixtures/settings-mcp'
import { EMcpDialog, McpView } from '../shared/mcp/mcp-view'

export function McpPage({
  initialRows = PROJECT_MCP_ROWS,
  openDialog = EMcpDialog.None,
  initialJson = '',
  onOpenPersonal,
}: {
  initialRows?: McpServer[]
  openDialog?: EMcpDialog
  initialJson?: string
  onOpenPersonal?: () => void
}) {
  return (
    <McpView
      scope={EMcpScope.Project}
      initialRows={initialRows}
      description="Tools every thread in this project can call, alongside your personal ones."
      openDialog={openDialog}
      initialJson={initialJson}
      onOpenPersonal={onOpenPersonal}
    />
  )
}
