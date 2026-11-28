import { GROUP_DESCRIPTION, groupNameProblem } from '@dltech/atlas-client/settings'
import { Button, EButtonVariant, ETextRole, ETextTone, Input, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import type { NativeStackHeaderItem } from 'expo-router'
import { useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'

import { useAuth } from '../../../auth/auth-provider'
import { saveGroup } from '../../../groups/use-groups'
import { SettingsScroll } from '../../../settings/settings-scroll'

export default function GroupFormScreen() {
  const { api } = useAuth()
  const { groupId, name: initialName } = useLocalSearchParams<{
    groupId?: string
    name?: string
  }>()
  const [name, setName] = useState(initialName ?? '')
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const problem = groupNameProblem({ name })
  const renaming = groupId !== undefined

  const handleSave = async () => {
    if (api === undefined || problem !== null || saving) return
    setSaving(true)
    setFailure(null)
    try {
      await saveGroup({ api, groupId, name: name.trim() })
      router.back()
    } catch {
      setFailure('The group could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => router.back()

  return (
    <SettingsScroll>
      <Stack.Screen
        options={{
          title: renaming ? 'Rename group' : 'New group',
          unstable_headerRightItems: (): NativeStackHeaderItem[] => [
            {
              type: 'button',
              label: 'Save',
              accessibilityLabel: 'Save group',
              disabled: problem !== null || saving,
              onPress: () => void handleSave(),
            },
          ],
          headerRight:
            Platform.OS === 'ios'
              ? undefined
              : () => (
                  <Button
                    label="Save"
                    disabled={problem !== null || saving}
                    onPress={() => void handleSave()}
                  />
                ),
        }}
      />
      <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
        {GROUP_DESCRIPTION}
      </Text>
      <View style={styles.field}>
        <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
          Name
        </Text>
        <Input
          value={name}
          onChangeText={setName}
          placeholder="Comp AI"
          accessibilityLabel="Group name"
          autoFocus
        />
        {name === '' || problem === null ? null : (
          <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
            {problem}
          </Text>
        )}
      </View>
      {failure === null ? null : (
        <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
          {failure}
        </Text>
      )}
      <View style={styles.actions}>
        <Button
          label={renaming ? 'Rename' : 'Create'}
          stretch
          loading={saving}
          disabled={problem !== null || saving}
          onPress={() => void handleSave()}
        />
        <Button label="Cancel" variant={EButtonVariant.Ghost} stretch onPress={handleCancel} />
      </View>
    </SettingsScroll>
  )
}

const styles = StyleSheet.create({
  field: {
    gap: space(1.5),
  },
  actions: {
    gap: space(2),
  },
})
