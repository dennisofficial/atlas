'use client'

import { EMcpScope } from '../fixtures/settings-mcp'
import { WORKSPACE_MCP_SERVERS, WORKSPACE_PROFILE } from '../fixtures/settings-workspace'
import { McpView } from '../../shared/mcp/mcp-view'

export function WorkspaceMcpPage() {
  return (
    <McpView
      scope={EMcpScope.Workspace}
      initialRows={WORKSPACE_MCP_SERVERS}
      description={`Tools shared with everyone in ${WORKSPACE_PROFILE.name}. Workspace values apply first, your personal values override them, and project values override both.`}
    />
  )
}
