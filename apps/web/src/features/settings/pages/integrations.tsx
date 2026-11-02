'use client'

import { useCloudQuery } from '@/lib/use-cloud-query'

import {
  fetchGithub,
  GITHUB_ORG_SCOPE,
  GITHUB_REPO_SCOPE,
  type GithubConnection,
} from '../data/personal/github-api'
import { fetchMcpServers } from '../data/personal/mcp-api'
import { QuerySection } from '../data/personal/query-boundary'
import { GithubIntegrationSkeleton, McpListSkeleton } from '../skeletons/library-skeletons'
import { useMcpStore } from '../data/personal/use-mcp-store'
import { INTEGRATIONS, type Integration } from '../fixtures/settings-account'
import { EBrand } from '@dltech/atlas-ui/components/brand-mark'
import { AccountIntegrationRow } from '../parts/account-integration-row'
import { McpServersSection } from '../parts/mcp-servers-section'
import { SettingsCard, SettingsPage, SettingsSection, Mono } from '../settings-layout'
import { GithubConnectPanel } from '../parts/github-connect-panel'
import { EGithubFlow, useGithubConnect } from '../data/personal/use-github-connect'

const GITHUB_ID = 'github'

export function githubIntegration(connection: GithubConnection): Integration {
  const base = INTEGRATIONS.find((integration) => integration.id === GITHUB_ID)
  const scopes = connection.connected ? connection.scopes : []
  const granted = (scope: string) => connection.connected && scopes.includes(scope)
  return {
    id: GITHUB_ID,
    name: 'GitHub',
    brand: EBrand.GitHub,
    description: base?.description ?? '',
    ...(connection.connected
      ? {
          connectedAs: connection.login,
          missingScopes: connection.missingScopes,
        }
      : {}),
    capabilities: [
      { label: 'Clone private repos', granted: granted(GITHUB_REPO_SCOPE) },
      { label: 'Open pull requests', granted: granted(GITHUB_REPO_SCOPE) },
      { label: 'Org-wide access', granted: granted(GITHUB_ORG_SCOPE) },
    ],
  }
}

export function GithubRow({
  connection,
  reload,
}: {
  connection: GithubConnection
  reload: () => void
}) {
  const control = useGithubConnect({ onChanged: reload })
  const integration = githubIntegration(connection)
  const missing = integration.missingScopes ?? []
  const busy = control.disconnecting || control.flow.status !== EGithubFlow.Idle
  return (
    <AccountIntegrationRow
      integration={integration}
      busy={busy}
      onConnect={control.connect}
      onDisconnect={control.disconnect}
    >
      {missing.length > 0 && control.flow.status === EGithubFlow.Idle ? (
        <p className="pl-12 text-sm text-muted-foreground">
          Reconnect to grant <Mono>{missing.join(', ')}</Mono>
        </p>
      ) : null}
      <GithubConnectPanel flow={control.flow} onCancel={control.cancel} onRetry={control.connect} />
    </AccountIntegrationRow>
  )
}

function IntegrationsList() {
  const query = useCloudQuery({ key: 'personal-github', load: fetchGithub })
  return (
    <SettingsSection title="Integrations" description="Accounts Atlas can act on your behalf.">
      <QuerySection query={query} title="GitHub" skeleton={<GithubIntegrationSkeleton />}>
        {(connection) => (
          <SettingsCard>
            <GithubRow connection={connection} reload={query.reload} />
          </SettingsCard>
        )}
      </QuerySection>
    </SettingsSection>
  )
}

function McpSection() {
  const query = useCloudQuery({ key: 'personal-mcp', load: fetchMcpServers })
  return (
    <QuerySection query={query} title="MCP servers" skeleton={<McpListSkeleton />}>
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
      description="MCP servers are saved to your account. Project servers override them."
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
    </SettingsPage>
  )
}
