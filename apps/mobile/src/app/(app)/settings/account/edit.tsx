import { Button, Card, ETextRole, ETextTone, Input, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { router, Stack } from 'expo-router'
import { useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'

import { useAccountApi } from '../../../../settings/account/use-account-api'
import { Row, StatusRows } from '../../../../settings/settings-parts'
import { SettingsScroll } from '../../../../settings/settings-scroll'
import { useApiResource } from '../../../../settings/use-api-resource'

const EditForm = ({
  initialName,
  email,
  onSave,
}: {
  initialName: string
  email: string
  onSave: (name: string) => Promise<void>
}) => {
  const [draft, setDraft] = useState(initialName)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const trimmed = draft.trim()
  const canSave = trimmed.length > 0 && trimmed !== initialName && !saving

  const handleChange = (value: string) => {
    setDraft(value)
    setFailure(null)
  }

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setFailure(null)
    try {
      await onSave(trimmed)
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Your name could not be saved.')
      setSaving(false)
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          unstable_headerRightItems: () =>
            Platform.OS === 'ios'
              ? [
                  {
                    type: 'button',
                    label: 'Save',
                    icon: { type: 'sfSymbol', name: 'checkmark' },
                    accessibilityLabel: 'Save name',
                    onPress: () => void handleSave(),
                  },
                ]
              : [],
        }}
      />
      <View style={styles.section}>
        <Card style={styles.fields}>
          <View style={styles.field}>
            <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
              Name
            </Text>
            <Input
              value={draft}
              onChangeText={handleChange}
              placeholder="Your name"
              accessibilityLabel="Name"
              autoCorrect={false}
            />
          </View>
        </Card>
        <Row label="Email" value={email} />
        <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
          Your name appears on threads and pull requests. Email is used for sign-in and cannot be
          changed here.
        </Text>
        {Platform.OS === 'ios' ? null : (
          <Button
            label="Save"
            stretch
            loading={saving}
            disabled={!canSave}
            onPress={() => void handleSave()}
          />
        )}
        {failure === null ? null : (
          <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
            {failure}
          </Text>
        )}
      </View>
    </>
  )
}

export default function AccountEditScreen() {
  const authApi = useAccountApi()
  const { state, data, reload } = useApiResource({
    load: () => {
      if (authApi === undefined) throw new Error('You are signed out')
      return authApi.getCurrentSession()
    },
    deps: [authApi],
  })

  const handleSave = async (name: string) => {
    if (authApi === undefined) throw new Error('You are signed out')
    await authApi.updateName(name)
    router.back()
  }

  return (
    <SettingsScroll>
      <StatusRows state={state} onRetry={reload} failure="Your account could not be loaded." />
      {data === null ? null : (
        <EditForm
          key={data.user?.name ?? ''}
          initialName={data.user?.name ?? ''}
          email={data.user?.email ?? ''}
          onSave={handleSave}
        />
      )}
    </SettingsScroll>
  )
}

const styles = StyleSheet.create({
  section: {
    gap: space(3),
  },
  fields: {
    gap: space(3),
  },
  field: {
    gap: space(1.5),
  },
})
