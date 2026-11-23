'use client'

import { useCallback } from 'react'
import { toast } from 'sonner'

import { EOauthProvider } from '@dltech/atlas-wire/web'

import { MODEL_PICKER_KEY } from '@/lib/cloud-keys'
import { useInvalidateCloud } from '@/lib/use-invalidate-cloud'

import {
  EAccountKind,
  activateAccount,
  createApiKeyAccount,
  removeAccount,
  renameAccount,
  replaceApiKey,
} from '../data/personal/accounts-api'
import { errorMessageOf } from '../data/personal/error-message'
import {
  useProviderAccounts,
  type ProviderAccountsData,
} from '../data/personal/provider-accounts-query'
import { QueryPage } from '../data/personal/query-boundary'
import {
  EProviderSignInState,
  type ProviderSignInControl,
  useProviderSignIn,
} from '../data/personal/use-provider-sign-in'
import { useSaveAction } from '../data/personal/use-save-action'
import { EProviderId, PROVIDERS, type ProviderInfo } from '../fixtures/settings-agent'
import { ProviderCard, type ProviderCardActions } from '../parts/provider-card'
import type { KeyDialogResult } from '../parts/provider-key-dialog'
import { UnconnectedProviders } from '../parts/provider-unconnected'
import { ProvidersSkeleton } from '../skeletons/library-skeletons'
import { SettingsPage, SettingsSection } from '../settings-layout'

const TITLE = 'Providers'
const DESCRIPTION =
  'Where Atlas gets model access. Each provider uses one account: the one marked In use.'

const IDLE_CONTROL: ProviderSignInControl = {
  flow: { status: EProviderSignInState.Idle },
  start: () => {},
  cancel: () => {},
  submitCode: () => {},
}

function useProviderSignIns(onChanged: () => void): Record<string, ProviderSignInControl> {
  const anthropic = useProviderSignIn({ provider: EOauthProvider.Anthropic, onChanged })
  const openai = useProviderSignIn({ provider: EOauthProvider.OpenAI, onChanged })
  return {
    [EProviderId.Anthropic]: anthropic,
    [EProviderId.OpenAI]: openai,
  }
}

export function ProvidersPage() {
  const query = useProviderAccounts()
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
  data: ProviderAccountsData
  reload: () => void
}) {
  const invalidateCloud = useInvalidateCloud()
  const reload = useCallback(() => {
    reloadQuery()
    void invalidateCloud([MODEL_PICKER_KEY])
  }, [reloadQuery, invalidateCloud])
  const { run } = useSaveAction()
  const signIns = useProviderSignIns(reload)

  const removedToastOf = useCallback(
    (accountId: string): string => {
      const account = data.accounts.find((candidate) => candidate.id === accountId)
      return account?.kind === EAccountKind.Oauth ? 'Signed out' : 'API key removed'
    },
    [data.accounts],
  )

  const accountsOf = useCallback(
    (provider: ProviderInfo) => data.accounts.filter((account) => account.provider === provider.id),
    [data.accounts],
  )

  const handleAddKey = useCallback(
    async (args: { provider: ProviderInfo; result: KeyDialogResult }): Promise<string | null> => {
      try {
        await createApiKeyAccount({
          provider: args.provider.id,
          apiKey: args.result.key,
          label: args.result.name,
          makeActive: args.result.use,
        })
      } catch (error) {
        return errorMessageOf(error)
      }
      toast.success('API key saved')
      reload()
      return null
    },
    [reload],
  )
  const handleReplace = useCallback(
    async (args: { accountId: string; key: string }): Promise<string | null> => {
      try {
        await replaceApiKey({ accountId: args.accountId, apiKey: args.key })
      } catch (error) {
        return errorMessageOf(error)
      }
      toast.success('API key replaced')
      reload()
      return null
    },
    [reload],
  )
  const handleUse = useCallback(
    (args: { provider: ProviderInfo; accountId: string }) =>
      run({
        work: async () => {
          await activateAccount({ provider: args.provider.id, accountId: args.accountId })
          reload()
        },
        success: 'Atlas will use that account',
      }),
    [run, reload],
  )
  const handleRename = useCallback(
    (args: { accountId: string; name: string }) =>
      run({
        work: async () => {
          await renameAccount({ accountId: args.accountId, label: args.name })
          reload()
        },
        success: 'Renamed',
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

  const actionsFor = (provider: ProviderInfo): ProviderCardActions => ({
    onUse: (accountId) => void handleUse({ provider, accountId }),
    onSignIn: () => signIns[provider.id]?.start(),
    onAddKey: (result) => handleAddKey({ provider, result }),
    onRename: (args) => void handleRename(args),
    onReplace: (args) => handleReplace(args),
    onRemove: (accountId) => void handleRemove({ accountId, success: removedToastOf(accountId) }),
  })

  const connected = PROVIDERS.filter((provider) => accountsOf(provider).length > 0)
  const unconnected = PROVIDERS.filter((provider) => accountsOf(provider).length === 0)

  return (
    <SettingsPage title={TITLE} description={DESCRIPTION}>
      {connected.length > 0 ? (
        <SettingsSection title="Connected">
          <div className="flex flex-col gap-4">
            {connected.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                accounts={accountsOf(provider)}
                inUseId={data.active[provider.id] ?? null}
                signIn={signIns[provider.id] ?? IDLE_CONTROL}
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
            signInOf={(provider) => signIns[provider.id] ?? IDLE_CONTROL}
            onAddKey={(args) => handleAddKey(args)}
          />
        </SettingsSection>
      ) : null}
    </SettingsPage>
  )
}
