import {
  EAccountKind,
  EKeyDialogMode,
  PROVIDER_CATALOGUE,
  providerAccountDetailOf,
} from '@dltech/atlas-client/settings'
import { ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'
import { EOauthProvider } from '@dltech/atlas-wire/web'
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { useAuth } from '../../../auth/auth-provider'
import { confirmAction } from '../../../settings/confirm-action'
import { ActionRow, EActionTone, Row, Section, StatusRows } from '../../../settings/settings-parts'
import { SettingsScroll } from '../../../settings/settings-scroll'
import { useApiResource } from '../../../settings/use-api-resource'
import { createProviderAccountsApi } from '../../../settings/providers/accounts-api'
import { ProviderSignInPanel } from '../../../settings/providers/sign-in-panel'
import { useProviderSignIn } from '../../../settings/providers/use-provider-sign-in'
import { ProviderUsage } from '../../../settings/providers/usage'

export default function ProviderAccountScreen() {
  const { api } = useAuth()
  const { accountId = '' } = useLocalSearchParams<{ accountId?: string }>()
  const [failure, setFailure] = useState('')
  const resource = useApiResource({
    load: () => {
      if (api === undefined) throw new Error('Sign in first')
      return createProviderAccountsApi(api).load()
    },
    deps: [api, accountId],
  })
  useFocusEffect(
    useCallback(() => {
      resource.reload()
    }, [resource.reload]),
  )
  const account = resource.data?.accounts.find((candidate) => candidate.id === accountId)
  const provider = PROVIDER_CATALOGUE.find((candidate) => candidate.id === account?.provider)
  const signIn = useProviderSignIn({
    provider: account?.provider === 'openai' ? EOauthProvider.OpenAI : EOauthProvider.Anthropic,
    onChanged: resource.reload,
  })
  const handleRemove = () =>
    confirmAction({
      title: account?.kind === EAccountKind.Oauth ? 'Sign out?' : 'Remove API key?',
      message: 'Atlas will no longer use this account. Other accounts are not removed.',
      confirmLabel: account?.kind === EAccountKind.Oauth ? 'Sign out' : 'Remove',
      destructive: true,
      onConfirm: () => {
        if (api === undefined) return
        void createProviderAccountsApi(api)
          .remove(accountId)
          .then(() => router.back())
          .catch((error: unknown) =>
            setFailure(error instanceof Error ? error.message : 'Account could not be removed'),
          )
      },
    })
  const handleEdit = (mode: EKeyDialogMode) =>
    router.push({
      pathname: '/settings/provider-key',
      params: { accountId, provider: provider?.id, mode },
    })
  return (
    <SettingsScroll>
      <StatusRows state={resource.state} onRetry={resource.reload} />
      {resource.data !== null && account === undefined ? (
        <Text size={ETextRole.Sm}>This account is no longer available.</Text>
      ) : null}
      {account === undefined || provider === undefined ? null : (
        <>
          <Section title={account.email ?? account.label}>
            <Row label="Provider" value={provider.name} />
            <Row label="Status" value={account.status} />
            <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={{ padding: 16 }}>
              {providerAccountDetailOf({ account, provider })}
            </Text>
            {account.kind === EAccountKind.Oauth ? <ProviderUsage accountId={accountId} /> : null}
            {resource.data?.active[provider.id] === account.id ? (
              <Row label="Account" value="In use" />
            ) : (
              <ActionRow
                label="Use for this provider"
                onPress={() => {
                  if (api === undefined) return
                  void createProviderAccountsApi(api)
                    .activate({ provider: provider.id, accountId })
                    .then(resource.reload)
                    .catch((error: unknown) =>
                      setFailure(
                        error instanceof Error ? error.message : 'Account could not be selected',
                      ),
                    )
                }}
              />
            )}
            {account.kind === EAccountKind.Oauth ? (
              <ActionRow label="Sign in again" onPress={signIn.start} />
            ) : (
              <>
                <ActionRow label="Rename" onPress={() => handleEdit(EKeyDialogMode.Rename)} />
                <ActionRow label="Replace key" onPress={() => handleEdit(EKeyDialogMode.Replace)} />
              </>
            )}
            <ActionRow
              label={account.kind === EAccountKind.Oauth ? 'Sign out' : 'Remove'}
              tone={EActionTone.Destructive}
              onPress={handleRemove}
            />
          </Section>
          <ProviderSignInPanel control={signIn} />
        </>
      )}
      {failure === '' ? null : (
        <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
          {failure}
        </Text>
      )}
    </SettingsScroll>
  )
}
