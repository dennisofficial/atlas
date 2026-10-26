import { INTEGRATIONS } from '../fixtures/settings-account'
import { AccountIntegrationRow } from '../parts/account-integration-row'
import { SettingsCard, SettingsPage } from '../settings-layout'

export function GithubPage() {
  return (
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
  )
}
