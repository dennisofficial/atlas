'use client'

import { useCallback } from 'react'

import { useCloudQuery } from '@/lib/use-cloud-query'

import {
  apiKeyFor,
  createApiKeyAccount,
  fetchAccounts,
  removeAccount,
  replaceApiKey,
  subscriptionFor,
  type Account,
} from '../data/personal/accounts-api'
import { QueryPage } from '../data/personal/query-boundary'
import { useSaveAction } from '../data/personal/use-save-action'
import { API_KEY_PROVIDERS, EProviderId } from '../fixtures/settings-agent'
import { ApiKeyRow } from '../parts/agent-api-key-row'
import { SubscriptionRow, type SubscriptionAccount } from '../parts/agent-subscription-row'
import { SettingsCard, SettingsPage, SettingsSection } from '../settings-layout'

const TITLE = 'Providers'
const DESCRIPTION =
  'Where Atlas gets model access. A subscription is used first, then an API key.'
const SIGN_IN_HINT = 'Sign in from the terminal with `atlas`.'

const SUBSCRIPTIONS = [
  {
    provider: EProviderId.Anthropic,
    name: 'Claude',
    letter: 'C',
    idleDescription: 'Use your Claude Pro or Max subscription.',
  },
  {
    provider: EProviderId.OpenAI,
    name: 'ChatGPT / Codex',
    letter: 'G',
    idleDescription: 'Use your ChatGPT Plus or Pro plan for GPT-5 models.',
  },
]

export function subscriptionView(account: Account | null): SubscriptionAccount | null {
  if (account === null) return null
  return {
    email: account.email ?? account.label,
    plan: account.subscription ?? 'Connected',
  }
}

export function ProvidersPage() {
  const query = useCloudQuery({ key: 'personal-accounts', load: fetchAccounts })
  return (
    <QueryPage query={query} title={TITLE} description={DESCRIPTION}>
      {(accounts) => <ProvidersContent accounts={accounts} reload={query.reload} />}
    </QueryPage>
  )
}

function ProvidersContent({ accounts, reload }: { accounts: Account[]; reload: () => void }) {
  const { saving, run } = useSaveAction()

  const handleKeySave = useCallback(
    (args: { provider: EProviderId; apiKey: string; existingId: string | null }) =>
      run({
        work: async () => {
          if (args.existingId === null) {
            await createApiKeyAccount({ provider: args.provider, apiKey: args.apiKey })
          } else {
            await replaceApiKey({ accountId: args.existingId, apiKey: args.apiKey })
          }
          reload()
        },
        success: 'API key saved',
      }),
    [run, reload],
  )
  const handleRemove = useCallback(
    (args: { accountId: string; success: string }) =>
      run({
        work: async () => {
          await removeAccount(args.accountId)
          reload()
        },
        success: args.success,
      }),
    [run, reload],
  )

  return (
    <SettingsPage title={TITLE} description={DESCRIPTION}>
      <SettingsSection
        title="Subscriptions"
        description="Sign in with a plan you already pay for. Takes precedence over API keys."
      >
        <SettingsCard>
          {SUBSCRIPTIONS.map((subscription) => {
            const account = subscriptionFor({ accounts, provider: subscription.provider })
            return (
              <SubscriptionRow
                key={subscription.provider}
                name={subscription.name}
                letter={subscription.letter}
                idleDescription={subscription.idleDescription}
                signInLabel={`Sign in with ${subscription.name.split(' ')[0]}`}
                signInHint={SIGN_IN_HINT}
                account={subscriptionView(account)}
                busy={saving}
                onSignOut={() => {
                  if (account !== null) {
                    void handleRemove({ accountId: account.id, success: 'Signed out' })
                  }
                }}
              />
            )
          })}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection
        title="API keys"
        description="Used when no subscription covers the model. Billed by the provider."
      >
        <SettingsCard>
          {API_KEY_PROVIDERS.map((provider) => {
            const entry = apiKeyFor({ accounts, provider: provider.id })
            return (
              <ApiKeyRow
                key={provider.id}
                provider={provider}
                entry={entry}
                busy={saving}
                onSave={(apiKey) =>
                  void handleKeySave({ provider: provider.id, apiKey, existingId: entry?.id ?? null })
                }
                onRemove={() => {
                  if (entry !== null) {
                    void handleRemove({ accountId: entry.id, success: 'API key removed' })
                  }
                }}
              />
            )
          })}
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}
