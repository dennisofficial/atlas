'use client'

import { useCloudQuery } from '@/lib/use-cloud-query'

import { fetchGithub, GITHUB_ORG_SCOPE, GITHUB_REPO_SCOPE, type GithubConnection } from '../data/personal/github-api'
import { fetchMcpServers } from '../data/personal/mcp-api'
import { QuerySection } from '../data/personal/query-boundary'
import { useMcpStore } from '../data/personal/use-mcp-store'
import { INTEGRATIONS, type Integration } from '../fixtures/settings-account'
import { EBrand } from '@dltech/atlas-ui/components/brand-mark'
import { AccountIntegrationRow } from '../parts/account-integration-row'
import { McpServersSection } from '../parts/mcp-servers-section'
import { McpSuggested } from '../parts/mcp-suggested'
import { SettingsCard, SettingsPage, SettingsSection } from '../settings-layout'

const GITHUB_ID = 'github'
const GITHUB_HINT = 'Connect GitHub from the terminal with `atlas`.'

export function githubIntegration(connection: GithubConnection): Integration {
  const base = INTEGRATIONS.find((integration) => integration.id === GITHUB_ID)
  const scopes = connection.connected ? connection.scopes : []
  const granted = (scope: string) => connection.connected && scopes.includes(scope)
  return {
    id: GITHUB_ID,
    name: 'GitHub',
    brand: EBrand.GitHub,
    description: connection.connected
      ? (base?.description ?? '')
      : `${base?.description ?? ''} ${GITHUB_HINT}`.trim(),
    ...(connection.connected ? { connectedAs: connection.login } : {}),
    capabilities: [
      { label: 'Clone private repos', granted: granted(GITHUB_REPO_SCOPE) },
      { label: 'Open pull requests', granted: granted(GITHUB_REPO_SCOPE) },
      { label: 'Org-wide access', granted: granted(GITHUB_ORG_SCOPE) },
    ],
  }
}

function IntegrationsList() {
  const query = useCloudQuery({ key: 'personal-github', load: fetchGithub })
  const sample = INTEGRATIONS.filter((integration) => integration.id !== GITHUB_ID)
  return (
    <SettingsSection title="Integrations" description="Accounts Atlas can act on your behalf.">
      <QuerySection query={query} title="GitHub" rows={1}>
        {(connection) => (
          <SettingsCard>
            <AccountIntegrationRow integration={githubIntegration(connection)} actionsDisabled />
            {sample.map((integration) => (
              <AccountIntegrationRow key={integration.id} integration={integration} />
            ))}
          </SettingsCard>
        )}
      </QuerySection>
    </SettingsSection>
  )
}

function McpSection() {
  const query = useCloudQuery({ key: 'personal-mcp', load: fetchMcpServers })
  return (
    <QuerySection query={query} title="MCP servers" rows={2}>
      {(servers) => <McpContent servers={servers} reload={query.reload} />}
    </QuerySection>
  )
}

function McpContent({
  servers,
  reload,
}: {
  servers: Awaited<ReturnType<typeof fetchMcpServers>>
  reload: () => void
}) {
  const store = useMcpStore({ servers, reload })
  return (
    <McpServersSection
      title="MCP servers"
      description="Personal MCP servers apply to every thread; project and workspace servers with the same id override them."
      store={store}
    />
  )
}

export function IntegrationsPage() {
  return (
    <SettingsPage
      title="Integrations & MCP"
      description="Connect accounts and tools so threads can reach beyond the sandbox."
    >
      <IntegrationsList />
      <McpSection />
      <McpSuggested />
    </SettingsPage>
  )
}
