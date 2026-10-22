import { WORKSPACE_MCP_SERVERS, type McpServer } from '../../../fixtures/settings-mcp'
import { McpServersSection } from '../parts/mcp-servers-section'
import { SettingsPage } from '../settings-layout'

export function WorkspaceMcpPage({ servers = WORKSPACE_MCP_SERVERS }: { servers?: McpServer[] }) {
  return (
    <SettingsPage title="MCP" description="Tools shared with everyone in DL Tech.">
      <McpServersSection
        description="Workspace values apply first, your personal values override them, and project values override both."
        initialServers={servers}
      />
    </SettingsPage>
  )
}
