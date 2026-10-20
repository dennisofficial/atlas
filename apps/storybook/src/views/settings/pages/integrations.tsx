import { INTEGRATIONS } from "../../../fixtures/settings-account";
import { PERSONAL_MCP_SERVERS } from "../../../fixtures/settings-mcp";
import { AccountIntegrationRow } from "../parts/account-integration-row";
import { McpServersSection } from "../parts/mcp-servers-section";
import { McpSuggested } from "../parts/mcp-suggested";
import { SettingsCard, SettingsPage, SettingsSection } from "../settings-layout";

export function IntegrationsPage() {
  return (
    <SettingsPage
      title="Integrations & MCP"
      description="Connect accounts and tools so threads can reach beyond the sandbox."
    >
      <SettingsSection title="Integrations" description="Accounts Atlas can act on your behalf.">
        <SettingsCard>
          {INTEGRATIONS.map((integration) => (
            <AccountIntegrationRow key={integration.id} integration={integration} />
          ))}
        </SettingsCard>
      </SettingsSection>
      <McpServersSection
        title="MCP servers"
        description="Personal MCP servers apply to every thread; project and workspace servers with the same id override them."
        initialServers={PERSONAL_MCP_SERVERS}
      />
      <McpSuggested />
    </SettingsPage>
  );
}
