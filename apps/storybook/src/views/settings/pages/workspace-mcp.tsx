import { WORKSPACE_MCP_SERVERS, type McpServer } from "../../../fixtures/settings-mcp";
import { McpServersSection } from "../parts/mcp-servers-section";
import { McpSuggested } from "../parts/mcp-suggested";
import { SettingsPage } from "../settings-layout";

export function WorkspaceMcpPage({ servers = WORKSPACE_MCP_SERVERS }: { servers?: McpServer[] }) {
  return (
    <SettingsPage
      title="MCP"
      description="Tools shared with everyone in DL Tech."
    >
      <McpServersSection
        description="Workspace MCP servers are available to every member; project servers with the same id override them, and personal servers override both."
        initialServers={servers}
      />
      <McpSuggested />
    </SettingsPage>
  );
}
