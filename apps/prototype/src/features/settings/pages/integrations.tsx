import { EMcpDialog, McpView } from '../../shared/mcp/mcp-view'
import { INTEGRATIONS } from '../fixtures/settings-account'
import { EMcpScope, PERSONAL_MCP_SERVERS, type McpServer } from '../fixtures/settings-mcp'
import { AccountIntegrationRow } from '../parts/account-integration-row'
import { SettingsCard, SettingsPage } from '../settings-layout'

export function IntegrationsPage({
  initial = PERSONAL_MCP_SERVERS,
  openDialog = EMcpDialog.None,
  initialJson = '',
}: {
  initial?: McpServer[]
  openDialog?: EMcpDialog
  initialJson?: string
}) {
  return (
    <div className="flex flex-col gap-12">
      <SettingsPage
        title="GitHub"
        description="Threads clone repositories and open pull requests as this account."
      >
        <SettingsCard>
          {INTEGRATIONS.map((integration) => (
            <AccountIntegrationRow key={integration.id} integration={integration} />
          ))}
        </SettingsCard>
      </SettingsPage>
      <McpView
        scope={EMcpScope.Personal}
        initialRows={initial}
        description="Tools every thread you start can call. A project's servers override yours."
        openDialog={openDialog}
        initialJson={initialJson}
      />
    </div>
  )
}
