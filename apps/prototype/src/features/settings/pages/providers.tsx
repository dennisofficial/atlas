import { useState } from 'react'

import {
  CURRENT_PROVIDERS,
  type ProviderInfo,
  type ProviderState,
  PROVIDERS,
} from '../fixtures/settings-providers'
import { type ProviderCardActions, ProviderCard } from '../parts/provider-card'
import type { KeyDialogResult } from '../parts/provider-key-dialog'
import {
  addAccount,
  maskKey,
  newApiKey,
  newPlanAccount,
  removeAccount,
  updateAccount,
  selectAccount,
} from '../parts/provider-state'
import { UnconnectedProviders } from '../parts/provider-unconnected'
import { SettingsPage, SettingsSection } from '../settings-layout'

const DESCRIPTION =
  'Where Atlas gets model access. Each provider uses one account: the one marked In use.'

export function ProvidersPage({ initial = CURRENT_PROVIDERS }: { initial?: ProviderState }) {
  const [state, setState] = useState(initial)
  const connected = PROVIDERS.filter((provider) => state.accounts[provider.id].length > 0)
  const unconnected = PROVIDERS.filter((provider) => state.accounts[provider.id].length === 0)

  const handleSignIn = (provider: ProviderInfo) =>
    setState((current) =>
      addAccount({
        state: current,
        provider: provider.id,
        account: newPlanAccount(provider),
        use: false,
      }),
    )
  const handleAddKey = (provider: ProviderInfo, result: KeyDialogResult) =>
    setState((current) =>
      addAccount({
        state: current,
        provider: provider.id,
        account: newApiKey({ provider, name: result.name, key: result.key }),
        use: result.use,
      }),
    )

  const actionsFor = (provider: ProviderInfo): ProviderCardActions => ({
    onUse: (accountId) =>
      setState((current) => selectAccount({ state: current, provider: provider.id, accountId })),
    onSignIn: () => handleSignIn(provider),
    onAddKey: (result) => handleAddKey(provider, result),
    onRename: (accountId, name) =>
      setState((current) =>
        updateAccount({ state: current, provider: provider.id, accountId, change: { name } }),
      ),
    onReplace: (accountId, key) =>
      setState((current) =>
        updateAccount({
          state: current,
          provider: provider.id,
          accountId,
          change: { masked: maskKey({ provider, key }), added: 'Replaced Nov 23' },
        }),
      ),
    onRemove: (accountId) =>
      setState((current) => removeAccount({ state: current, provider: provider.id, accountId })),
  })

  return (
    <SettingsPage title="Providers" description={DESCRIPTION}>
      {connected.length > 0 ? (
        <SettingsSection title="Connected">
          <div className="flex flex-col gap-4">
            {connected.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                accounts={state.accounts[provider.id]}
                inUseId={state.inUse[provider.id]}
                actions={actionsFor(provider)}
              />
            ))}
          </div>
        </SettingsSection>
      ) : null}
      {unconnected.length > 0 ? (
        <SettingsSection
          title="Add a provider"
          description="Sign in with a plan you already pay for, or add an API key billed by the provider."
        >
          <UnconnectedProviders
            providers={unconnected}
            onSignIn={handleSignIn}
            onAddKey={handleAddKey}
          />
        </SettingsSection>
      ) : null}
    </SettingsPage>
  )
}
