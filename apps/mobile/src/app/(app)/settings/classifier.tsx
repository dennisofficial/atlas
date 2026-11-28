import {
  classifierAvailabilityIn,
  classifierChanges,
  classifierFeaturesOf,
  classifierModelItems,
  classifierModelOf,
  classifierPlanOnlyText,
  classifierSettingsFrom,
  classifierStatusOf,
  classifierSuggestionOf,
  classifierTestLineOf,
  EAccountKind,
  EKeyDialogMode,
  providerIdOf,
  type Account,
  type ClassifierTestLine,
} from '@dltech/atlas-client/settings'
import { providerLabelOf } from '@dltech/atlas-core'
import { Button, ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'
import { router, Stack, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Platform } from 'react-native'
import { useAuth } from '../../../auth/auth-provider'
import { ChoiceRow } from '../../../settings/choice-row'
import { ActionRow, NavRow, Section, StatusRows } from '../../../settings/settings-parts'
import { SettingsScroll } from '../../../settings/settings-scroll'
import { useSettings } from '../../../settings/settings-provider'
import { useApiResource } from '../../../settings/use-api-resource'
import { EResourceState } from '../../../settings/api-resource-state'

function ClassifierEditor({ accounts }: { accounts: readonly Account[] }) {
  const { api } = useAuth()
  const settings = useSettings()
  const saved = classifierSettingsFrom(settings.values)
  const [stored, setStored] = useState(saved.model)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [failure, setFailure] = useState('')
  const [lastTest, setLastTest] = useState<ClassifierTestLine | null>(null)
  const dirty = saved.model !== stored
  const availability = classifierAvailabilityIn({ stored, accounts })
  const status = classifierStatusOf(availability)
  const suggestion = stored === '' ? classifierSuggestionOf(accounts) : undefined
  const model = classifierModelOf(stored)
  const existing = accounts.find(
    (account) => account.provider === model?.provider && account.kind === EAccountKind.ApiKey,
  )
  const planOnly = accounts.some(
    (account) => account.provider === model?.provider && account.kind === EAccountKind.Oauth,
  )
  const features = classifierFeaturesOf({
    on: availability.on,
    skillsSuggest: settings.values.get('skills.suggest') !== false,
    qualityEnabled: settings.values.get('quality.enabled') === true,
  })
  const handleSave = async () => {
    setSaving(true)
    setFailure('')
    try {
      await settings.save(classifierChanges({ saved, draft: { model: stored } }))
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Classifier could not be saved')
    } finally {
      setSaving(false)
    }
  }
  const handleTest = async () => {
    if (api === undefined || dirty || testing || saving) return
    setTesting(true)
    try {
      setLastTest(await api.classifier.test.mutate())
    } catch (error) {
      setLastTest({
        ok: false,
        fault: 'unreachable',
        detail: error instanceof Error ? error.message : 'Test failed',
      })
    } finally {
      setTesting(false)
    }
  }
  const handleKey = () => {
    if (model === undefined) return
    router.push({
      pathname: '/settings/provider-key',
      params: {
        provider: providerIdOf(model.provider),
        accountId: existing?.id,
        mode: existing === undefined ? EKeyDialogMode.Add : EKeyDialogMode.Replace,
      },
    })
  }
  return (
    <>
      <Stack.Screen
        options={{
          unstable_headerRightItems:
            Platform.OS === 'ios'
              ? () => [
                  {
                    type: 'button',
                    label: 'Save',
                    icon: { type: 'sfSymbol', name: 'checkmark' },
                    disabled: !dirty || saving,
                    onPress: () => {
                      void handleSave()
                    },
                  },
                ]
              : undefined,
        }}
      />
      <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
        One model answers the yes/no questions behind skill suggestion and the Jev code review. It
        is never your chat model.
      </Text>
      <Section title="Model">
        <ChoiceRow
          label="Classifier model"
          value={stored}
          options={classifierModelItems()}
          onChange={setStored}
        />
        <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={{ padding: 16 }}>
          {status.text}
        </Text>
        {classifierTestLineOf(lastTest) === undefined ? null : (
          <Text size={ETextRole.Sm} style={{ padding: 16 }}>
            {classifierTestLineOf(lastTest)}
          </Text>
        )}
        {dirty ? (
          <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={{ padding: 16 }}>
            Save first
          </Text>
        ) : (
          <ActionRow
            label={testing ? 'Testing…' : 'Test'}
            loading={testing || saving}
            onPress={() => {
              void handleTest()
            }}
          />
        )}
        {suggestion === undefined ? null : (
          <ActionRow label={`Use ${suggestion.label}`} onPress={() => setStored(suggestion.ref)} />
        )}
        {model === undefined || availability.on ? null : (
          <>
            <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={{ padding: 16 }}>
              {existing === undefined
                ? planOnly
                  ? classifierPlanOnlyText({
                      providerLabel: providerLabelOf(model.provider) ?? model.provider,
                    })
                  : `${providerLabelOf(model.provider)} is not connected.`
                : `Key: ${existing.label}`}
            </Text>
            <ActionRow
              label={
                existing === undefined
                  ? `Add a ${providerLabelOf(model.provider)} key`
                  : 'Replace key'
              }
              onPress={handleKey}
            />
          </>
        )}
        <NavRow label="Open Providers" onPress={() => router.push('/settings/providers')} />
      </Section>
      <Section title="Features that use it">
        {features.map((feature) => (
          <NavRow
            key={feature.label}
            label={feature.label}
            value={feature.state}
            onPress={() =>
              router.push(feature.linkLabel === 'Skills' ? '/settings/skills' : '/settings/quality')
            }
          />
        ))}
      </Section>
      {failure === '' ? null : (
        <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
          {failure}
        </Text>
      )}
      {!dirty ? null : (
        <>
          {Platform.OS === 'ios' ? null : (
            <Button
              label="Save"
              disabled={saving}
              loading={saving}
              onPress={() => {
                void handleSave()
              }}
            />
          )}
          <ActionRow label="Discard" onPress={() => setStored(saved.model)} />
        </>
      )}
    </>
  )
}

export default function ClassifierScreen() {
  const { api } = useAuth()
  const settings = useSettings()
  const resource = useApiResource({
    load: () => {
      if (api === undefined) throw new Error('Sign in first')
      return api.accounts.list.query()
    },
    deps: [api],
  })
  useFocusEffect(
    useCallback(() => {
      resource.reload()
    }, [resource.reload]),
  )
  return (
    <SettingsScroll>
      <StatusRows state={resource.state} onRetry={resource.reload} />
      <StatusRows
        state={
          settings.failed
            ? EResourceState.Failed
            : settings.ready
              ? EResourceState.Ready
              : EResourceState.Loading
        }
        onRetry={settings.reload}
      />
      {resource.data === null || !settings.ready ? null : (
        <ClassifierEditor accounts={resource.data} />
      )}
    </SettingsScroll>
  )
}
