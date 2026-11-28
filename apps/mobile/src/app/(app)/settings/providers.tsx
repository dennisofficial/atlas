import {
  EAccountKind,
  EKeyDialogMode,
  EProviderId,
  EProviderSignInState,
  providerAccountDetailOf,
  providerGroupsOf,
  type Account,
  type ProviderInfo,
  type ProviderSignInControl,
} from '@dltech/atlas-client/settings'
import {
  Button,
  EButtonSize,
  EButtonVariant,
  ETextRole,
  ETextTone,
  Text,
} from '@dltech/atlas-ui-native'
import { EOauthProvider } from '@dltech/atlas-wire/web'
import { router, Stack, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Platform, View } from 'react-native'
import { useAuth } from '../../../auth/auth-provider'
import { ChoiceRow } from '../../../settings/choice-row'
import { ActionRow, NavRow, Section, StatusRows } from '../../../settings/settings-parts'
import { SettingsScroll } from '../../../settings/settings-scroll'
import { useApiResource } from '../../../settings/use-api-resource'
import { createProviderAccountsApi } from '../../../settings/providers/accounts-api'
import { ProviderSignInPanel } from '../../../settings/providers/sign-in-panel'
import { useProviderSignIn } from '../../../settings/providers/use-provider-sign-in'
import { ProviderUsage } from '../../../settings/providers/usage'

const handleAdd = () => router.push('/settings/provider-key')
const IDLE: ProviderSignInControl = {
  flow: { status: EProviderSignInState.Idle },
  start: () => undefined,
  cancel: () => undefined,
  submitCode: () => undefined,
}

function ProviderSection({
  provider,
  accounts,
  active,
  signIn,
  onUse,
}: {
  provider: ProviderInfo
  accounts: readonly Account[]
  active: string | null
  signIn: ProviderSignInControl
  onUse: (id: string) => void
}) {
  return (
    <>
      <Section title={provider.name}>
        <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={{ padding: 16 }}>
          {provider.description}
        </Text>
        {accounts.length > 0 ? (
          <ChoiceRow
            label="Account in use"
            value={active ?? ''}
            options={accounts.map((account) => ({
              value: account.id,
              label: account.email ?? account.label,
            }))}
            onChange={onUse}
          />
        ) : null}
        {accounts.map((account) => (
          <View key={account.id}>
            <NavRow
              label={`${account.email ?? account.label}${account.id === active ? ', In use' : ''}`}
              onPress={() =>
                router.push({
                  pathname: '/settings/provider-account',
                  params: { accountId: account.id },
                })
              }
            />
            <Text
              size={ETextRole.Xs}
              tone={ETextTone.Muted}
              style={{ paddingHorizontal: 16, paddingBottom: 12 }}
            >
              {providerAccountDetailOf({ account, provider })}
            </Text>
            {account.kind === EAccountKind.Oauth ? <ProviderUsage accountId={account.id} /> : null}
          </View>
        ))}
        {provider.plan === undefined ? null : (
          <ActionRow
            label={provider.plan.signInLabel}
            onPress={signIn.start}
            loading={signIn.flow.status === EProviderSignInState.Starting}
          />
        )}
        <ActionRow
          label={`Add ${provider.name} API key`}
          onPress={() =>
            router.push({
              pathname: '/settings/provider-key',
              params: { provider: provider.id, mode: EKeyDialogMode.Add },
            })
          }
        />
      </Section>
      <ProviderSignInPanel control={signIn} />
    </>
  )
}

export default function ProvidersScreen() {
  const { api } = useAuth()
  const [failure, setFailure] = useState('')
  const resource = useApiResource({
    load: () => {
      if (api === undefined) throw new Error('Sign in first')
      return createProviderAccountsApi(api).load()
    },
    deps: [api],
  })
  useFocusEffect(
    useCallback(() => {
      resource.reload()
    }, [resource.reload]),
  )
  const anthropic = useProviderSignIn({
    provider: EOauthProvider.Anthropic,
    onChanged: resource.reload,
  })
  const openai = useProviderSignIn({ provider: EOauthProvider.OpenAI, onChanged: resource.reload })
  const groups = providerGroupsOf(resource.data?.accounts ?? [])
  const handleUse = async (args: { provider: EProviderId; accountId: string }) => {
    if (api === undefined) return
    setFailure('')
    try {
      await createProviderAccountsApi(api).activate(args)
      resource.reload()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Account could not be selected')
    }
  }
  return (
    <SettingsScroll>
      <Stack.Screen
        options={{
          unstable_headerRightItems:
            Platform.OS === 'ios'
              ? () => [
                  {
                    type: 'button',
                    label: 'Add',
                    icon: { type: 'sfSymbol', name: 'plus' },
                    onPress: handleAdd,
                  },
                ]
              : undefined,
          headerRight:
            Platform.OS === 'ios'
              ? undefined
              : () => (
                  <Button
                    label="Add"
                    size={EButtonSize.Sm}
                    variant={EButtonVariant.Ghost}
                    onPress={handleAdd}
                  />
                ),
        }}
      />
      <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
        Where Atlas gets model access. Each provider uses one account: the one marked In use.
      </Text>
      <StatusRows state={resource.state} onRetry={resource.reload} />
      {failure === '' ? null : (
        <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
          {failure}
        </Text>
      )}
      {resource.data === null
        ? null
        : [true, false].map((connected) => (
            <View key={String(connected)} style={{ gap: 16 }}>
              <Text size={ETextRole.Sm}>{connected ? 'Connected' : 'Add a provider'}</Text>
              {groups
                .filter((group) => group.accounts.length > 0 === connected)
                .map(({ provider, accounts }) => (
                  <ProviderSection
                    key={provider.id}
                    provider={provider}
                    accounts={accounts}
                    active={resource.data?.active[provider.id] ?? null}
                    signIn={
                      provider.id === EProviderId.Anthropic
                        ? anthropic
                        : provider.id === EProviderId.OpenAI
                          ? openai
                          : IDLE
                    }
                    onUse={(accountId) => {
                      void handleUse({ provider: provider.id, accountId })
                    }}
                  />
                ))}
            </View>
          ))}
    </SettingsScroll>
  )
}
