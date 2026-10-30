'use client'

import { useCallback } from 'react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'

import { MODEL_PICKER_KEY } from '@/lib/cloud-keys'
import { useCloudQuery } from '@/lib/use-cloud-query'
import { useInvalidateCloud } from '@/lib/use-invalidate-cloud'

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
import { EProviderSignInState, useProviderSignIn } from '../data/personal/use-provider-sign-in'
import { useSaveAction } from '../data/personal/use-save-action'
import { API_KEY_PROVIDERS, EProviderId } from '../fixtures/settings-agent'
import { ApiKeyRow } from '../parts/agent-api-key-row'
import { ProviderSignInPanel } from '../parts/provider-sign-in-panel'
import { SubscriptionRow, type SubscriptionAccount } from '../parts/agent-subscription-row'
import { EOauthProvider } from '@dltech/atlas-wire/web'
import { BrandMark, EBrand } from '@dltech/atlas-ui/components/brand-mark'
import { SettingsCard, SettingsPage, SettingsRow, SettingsSection } from '../settings-layout'

const TITLE = 'Providers'
const DESCRIPTION = 'Where Atlas gets model access. A subscription is used first, then an API key.'

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
]

export function subscriptionView(account: Account | null): SubscriptionAccount | null {
  if (account === null) return null
  return {
    email: account.email ?? account.label,
    plan: account.subscription ?? 'Connected',
  }
}

export function ProvidersPage() {
  const query = useCloudQuery({
    key: 'personal-accounts',
    load: fetchAccounts,
  })
  return (
    <QueryPage query={query} title={TITLE} description={DESCRIPTION}>
      {(accounts) => <ProvidersContent accounts={accounts} reload={query.reload} />}
    </QueryPage>
  )
}

function ProvidersContent({
  accounts,
  reload: reloadAccounts,
}: {
  accounts: Account[]
  reload: () => void
}) {
  const invalidateCloud = useInvalidateCloud()
  const reload = useCallback(() => {
    reloadAccounts()
    void invalidateCloud([MODEL_PICKER_KEY])
  }, [reloadAccounts, invalidateCloud])
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
            const account = subscriptionFor({
              accounts,
              provider: subscription.provider,
            })
            return (
              <SubscriptionSignInRow
                key={subscription.provider}
                subscription={subscription}
                account={account}
                busy={saving}
                reload={reload}
                onSignOut={(accountId) => void handleRemove({ accountId, success: 'Signed out' })}
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
          <AiGatewayRow />
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}

function SubscriptionSignInRow({
  subscription,
  account,
  busy,
  reload,
  onSignOut,
}: {
  subscription: (typeof SUBSCRIPTIONS)[number]
  account: Account | null
  busy: boolean
  reload: () => void
  onSignOut: (accountId: string) => void
}) {
  const control = useProviderSignIn({
    provider: subscription.oauthProvider,
    onChanged: reload,
  })
  return (
    <SubscriptionRow
      name={subscription.name}
      brand={subscription.brand}
      idleDescription={subscription.idleDescription}
      signInLabel={`Sign in with ${subscription.name.split(' ')[0]}`}
      account={subscriptionView(account)}
      busy={busy}
      signInBusy={control.flow.status !== EProviderSignInState.Idle}
      signInPanel={
        <ProviderSignInPanel
          name={subscription.name.split(' ')[0] ?? subscription.name}
          control={control}
        />
      }
      onSignIn={control.start}
      onSignOut={() => {
        if (account !== null) onSignOut(account.id)
      }}
    />
  )
}

function AiGatewayRow() {
  return (
    <SettingsRow
      media={<BrandMark brand={EBrand.Vercel} />}
      title={
        <>
          Vercel AI Gateway
          <Badge variant="outline">Coming soon</Badge>
        </>
      }
      description="Every major model behind one key, billed through Vercel."
      control={
        <Button variant="outline" size="sm" disabled>
          Add key
        </Button>
      }
    />
  )
}
