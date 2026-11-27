import {
  EKeyDialogMode,
  EProviderId,
  PROVIDER_CATALOGUE,
  providerKeyReady,
  providerKeyResult,
  type Account,
} from '@dltech/atlas-client/settings'
import {
  Button,
  EButtonSize,
  EButtonVariant,
  ETextRole,
  ETextTone,
  Input,
  Text,
} from '@dltech/atlas-ui-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Platform, View } from 'react-native'
import { useAuth } from '../../../auth/auth-provider'
import { ChoiceRow } from '../../../settings/choice-row'
import { Section, StatusRows } from '../../../settings/settings-parts'
import { SettingsScroll } from '../../../settings/settings-scroll'
import { SwitchRow } from '../../../settings/switch-row'
import { useApiResource } from '../../../settings/use-api-resource'
import { createProviderAccountsApi } from '../../../settings/providers/accounts-api'

function KeyEditor({
  initialName,
  accounts,
  accountId,
  initialProvider,
  mode,
}: {
  initialName: string
  accounts: readonly Account[]
  accountId: string
  initialProvider: EProviderId
  mode: EKeyDialogMode
}) {
  const { api } = useAuth()
  const [providerId, setProviderId] = useState(initialProvider)
  const [name, setName] = useState(initialName)
  const [key, setKey] = useState('')
  const [use, setUse] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState('')
  const offerUse = accounts.some((account) => account.provider === providerId)
  const provider = PROVIDER_CATALOGUE.find((candidate) => candidate.id === providerId)
  const asksName = mode !== EKeyDialogMode.Replace
  const asksKey = mode !== EKeyDialogMode.Rename
  const ready = providerKeyReady({ mode, name, key }) && !saving
  const title =
    mode === EKeyDialogMode.Add
      ? 'Add API key'
      : mode === EKeyDialogMode.Rename
        ? 'Rename API key'
        : 'Replace API key'
  const handleSave = async () => {
    if (api === undefined || !ready) return
    setSaving(true)
    setFailure('')
    const result = providerKeyResult({ name, key, use, offerUse })
    const accounts = createProviderAccountsApi(api)
    try {
      if (mode === EKeyDialogMode.Add) await accounts.add({ provider: providerId, ...result })
      else if (mode === EKeyDialogMode.Replace)
        await accounts.replace({ accountId, key: result.key })
      else await accounts.rename({ accountId, name: result.name })
      router.back()
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : 'This key was not accepted. Check it and try again.',
      )
    } finally {
      setSaving(false)
    }
  }
  return (
    <>
      <Stack.Screen
        options={{
          title,
          unstable_headerLeftItems:
            Platform.OS === 'ios'
              ? () => [
                  {
                    type: 'button',
                    label: 'Cancel',
                    icon: { type: 'sfSymbol', name: 'xmark' },
                    onPress: () => router.back(),
                  },
                ]
              : undefined,
          unstable_headerRightItems:
            Platform.OS === 'ios'
              ? () => [
                  {
                    type: 'button',
                    label: 'Save',
                    icon: { type: 'sfSymbol', name: 'checkmark' },
                    disabled: !ready,
                    onPress: () => {
                      void handleSave()
                    },
                  },
                ]
              : undefined,
        }}
      />
      <Section title={title}>
        {mode === EKeyDialogMode.Add ? (
          <ChoiceRow
            label="Provider"
            value={providerId}
            options={PROVIDER_CATALOGUE.map((item) => ({ value: item.id, label: item.name }))}
            onChange={setProviderId}
          />
        ) : null}
        <View style={{ padding: 16, gap: 12 }}>
          {asksName ? (
            <>
              <Text size={ETextRole.Sm}>Name</Text>
              <Input
                accessibilityLabel="Name"
                value={name}
                onChangeText={setName}
                placeholder="Work, Personal, CI…"
              />
            </>
          ) : null}
          {asksKey ? (
            <>
              <Text size={ETextRole.Sm}>API key</Text>
              <Input
                accessibilityLabel="API key"
                secureTextEntry
                value={key}
                onChangeText={setKey}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={provider?.keyPrefix ? `${provider.keyPrefix}…` : 'Paste your API key'}
              />
              <Text
                size={ETextRole.Sm}
                tone={ETextTone.Muted}
              >{`Stored encrypted and sent only to ${provider?.name}. You cannot see it again after you save it.`}</Text>
            </>
          ) : null}
        </View>
        {mode === EKeyDialogMode.Add && offerUse ? (
          <SwitchRow
            label={`Use this key for ${provider?.name} now`}
            value={use}
            onValueChange={setUse}
          />
        ) : null}
      </Section>
      {failure === '' ? null : (
        <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
          {failure}
        </Text>
      )}
      {Platform.OS === 'ios' ? null : (
        <>
          <Button
            label="Save"
            loading={saving}
            disabled={!ready}
            onPress={() => {
              void handleSave()
            }}
          />
          <Button
            label="Cancel"
            size={EButtonSize.Sm}
            variant={EButtonVariant.Ghost}
            onPress={() => router.back()}
          />
        </>
      )}
    </>
  )
}

export default function ProviderKeyScreen() {
  const { api } = useAuth()
  const params = useLocalSearchParams<{ provider?: string; accountId?: string; mode?: string }>()
  const accountId = params.accountId ?? ''
  const mode =
    Object.values(EKeyDialogMode).find((item) => item === params.mode) ?? EKeyDialogMode.Add
  const provider =
    PROVIDER_CATALOGUE.find((item) => item.id === params.provider)?.id ?? EProviderId.Anthropic
  const resource = useApiResource({
    load: () => {
      if (api === undefined) throw new Error('Sign in first')
      return createProviderAccountsApi(api).load()
    },
    deps: [api, accountId],
  })
  const account = resource.data?.accounts.find((item) => item.id === accountId)
  return (
    <SettingsScroll>
      <StatusRows state={resource.state} onRetry={resource.reload} />
      {resource.data === null ? null : mode !== EKeyDialogMode.Add && account === undefined ? (
        <Text size={ETextRole.Sm}>This account is no longer available.</Text>
      ) : (
        <KeyEditor
          initialName={account?.label ?? ''}
          initialProvider={provider}
          accountId={accountId}
          mode={mode}
          accounts={resource.data.accounts}
        />
      )}
    </SettingsScroll>
  )
}
