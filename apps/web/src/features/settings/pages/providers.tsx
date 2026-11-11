'use client'

import { useCallback } from 'react'

import { EOauthProvider } from '@dltech/atlas-wire/web'
import { EBrand } from '@dltech/atlas-ui/components/brand-mark'

import { MODEL_PICKER_KEY } from '@/lib/cloud-keys'
import { useCloudQuery } from '@/lib/use-cloud-query'
import { useInvalidateCloud } from '@/lib/use-invalidate-cloud'

import {
  activateAccount,
  apiKeyFor,
  createApiKeyAccount,
  fetchAccounts,
  fetchActiveAccountId,
  removeAccount,
  replaceApiKey,
  type Account,
} from '../data/personal/accounts-api'
import { loginsOf } from '../data/personal/provider-logins'
import { QueryPage } from '../data/personal/query-boundary'
import { useProviderSignIn } from '../data/personal/use-provider-sign-in'
import { useSaveAction } from '../data/personal/use-save-action'
import { API_KEY_PROVIDERS, EProviderId } from '../fixtures/settings-agent'
import { ApiKeyRow } from '../parts/agent-api-key-row'
import { ProviderLoginsCard } from '../parts/provider-logins-card'
import { ProvidersSkeleton } from '../skeletons/library-skeletons'
import { SettingsCard, SettingsPage, SettingsSection } from '../settings-layout'

const TITLE = 'Providers'
const DESCRIPTION = 'Where Atlas gets model access. A subscription is used first, then an API key.'

const ACCOUNTS_KEY = 'provider-logins'

const SUBSCRIPTIONS = [
  {
    provider: EProviderId.Anthropic,
    oauthProvider: EOauthProvider.Anthropic,
    name: 'Claude',
    brand: EBrand.Claude,
    idleDescription: 'Use your Claude Pro or Max subscription.',
  },
  {
    provider: EProviderId.OpenAI,
    oauthProvider: EOauthProvider.OpenAI,
    name: 'ChatGPT / Codex',
    brand: EBrand.OpenAI,
    idleDescription: 'Use your ChatGPT Plus or Pro plan for GPT-5 models.',
  },
] as const

type Subscription = (typeof SUBSCRIPTIONS)[number]

type ProvidersData = {
  accounts: readonly Account[]
  active: Readonly<Record<string, string | null>>
}

async function loadProviders(): Promise<ProvidersData> {
  const [accounts, active] = await Promise.all([
    fetchAccounts(),
    Promise.all(
      SUBSCRIPTIONS.map(
        async (subscription) =>
          [subscription.provider, await fetchActiveAccountId(subscription.provider)] as const,
      ),
    ),
  ])
  return { accounts, active: Object.fromEntries(active) }
}

export function ProvidersPage() {
  const query = useCloudQuery({ key: ACCOUNTS_KEY, load: loadProviders })
  return (
    <QueryPage
      query={query}
      title={TITLE}
      description={DESCRIPTION}
      skeleton={<ProvidersSkeleton />}
    >
      {(data) => <ProvidersContent data={data} reload={query.reload} />}
    </QueryPage>
  )
}

function ProvidersContent({
  data,
  reload: reloadQuery,
}: {
  data: ProvidersData
  reload: () => void
}) {
  const invalidateCloud = useInvalidateCloud()
  const reload = useCallback(() => {
    reloadQuery()
    void invalidateCloud([MODEL_PICKER_KEY])
  }, [reloadQuery, invalidateCloud])
  const { saving, run } = useSaveAction()

  const handleKeySave = useCallback(
    (args: { provider: EProviderId; apiKey: string; existingId: string | null }) =>
      run({
        work: async () => {
          if (args.existingId === null) {
            await createApiKeyAccount({
              provider: args.provider,
              apiKey: args.apiKey,
            })
          } else {
            await replaceApiKey({
              accountId: args.existingId,
              apiKey: args.apiKey,
            })
          }
          reload()
        },
        success: 'API key saved',
      }),
    [run, reload],
  )
  const handleSwitch = useCallback(
    (args: { provider: EProviderId; accountId: string }) =>
      run({
        work: async () => {
          await activateAccount(args)
          reload()
        },
        success: 'Atlas will use that account',
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
        description="Sign in with the plans you already pay for, then choose the account each provider uses. A subscription takes precedence over an API key."
      >
        <SettingsCard>
          {SUBSCRIPTIONS.map((subscription) => (
            <SubscriptionGroup
              key={subscription.provider}
              subscription={subscription}
              accounts={data.accounts}
              activeId={data.active[subscription.provider] ?? null}
              busy={saving}
              reload={reload}
              onSwitch={(accountId) =>
                void handleSwitch({ provider: subscription.provider, accountId })
              }
              onRemove={(accountId) => void handleRemove({ accountId, success: 'Signed out' })}
            />
          ))}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection
        title="API keys"
        description="Used when no subscription covers the model. Billed by the provider."
      >
        <SettingsCard>
          {API_KEY_PROVIDERS.map((provider) => {
            const entry = apiKeyFor({ accounts: data.accounts, provider: provider.id })
            return (
              <ApiKeyRow
                key={provider.id}
                provider={provider}
                entry={entry}
                busy={saving}
                onSave={(apiKey) =>
                  void handleKeySave({
                    provider: provider.id,
                    apiKey,
                    existingId: entry?.id ?? null,
                  })
                }
                onRemove={() => {
                  if (entry !== null) {
                    void handleRemove({
                      accountId: entry.id,
                      success: 'API key removed',
                    })
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

function SubscriptionGroup({
  subscription,
  accounts,
  activeId,
  busy,
  reload,
  onSwitch,
  onRemove,
}: {
  subscription: Subscription
  accounts: readonly Account[]
  activeId: string | null
  busy: boolean
  reload: () => void
  onSwitch: (accountId: string) => void
  onRemove: (accountId: string) => void
}) {
  const control = useProviderSignIn({
    provider: subscription.oauthProvider,
    onChanged: reload,
  })
  const logins = loginsOf({ accounts, provider: subscription.provider, activeId })
  return (
    <ProviderLoginsCard
      provider={subscription}
      logins={logins.logins}
      activeId={logins.activeId}
      busy={busy}
      signIn={control}
      onSwitch={onSwitch}
      onRemove={onRemove}
    />
  )
}
