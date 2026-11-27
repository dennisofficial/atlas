import { skillNameIsValid, type SkillScopeTarget } from '@dltech/atlas-client/settings'
import {
  Button,
  Card,
  EButtonSize,
  EButtonVariant,
  ETextRole,
  ETextTone,
  Input,
  Text,
} from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { router, Stack } from 'expo-router'
import { useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'

import { useAuth } from '../auth/auth-provider'
import { SettingsScroll } from '../settings/settings-scroll'
import { useSkills } from './use-skills'

export const NewSkillForm = ({ target }: { target: SkillScopeTarget }) => {
  const { api } = useAuth()
  const { create } = useSkills({ api, target })
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const valid = skillNameIsValid({ name })

  const handleCreate = async () => {
    if (!valid || busy) return
    setBusy(true)
    setFailure(null)
    try {
      await create({ name })
      router.back()
    } catch {
      setFailure('The skill could not be created.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsScroll>
      <Stack.Screen
        options={
          Platform.OS === 'ios'
            ? {
                unstable_headerRightItems: () => [
                  {
                    type: 'button',
                    label: 'Create',
                    disabled: !valid || busy,
                    onPress: () => void handleCreate(),
                  },
                ],
              }
            : {
                headerRight: () => (
                  <Button
                    label="Create"
                    variant={EButtonVariant.Ghost}
                    size={EButtonSize.Sm}
                    disabled={!valid || busy}
                    onPress={() => void handleCreate()}
                  />
                ),
              }
        }
      />
      <View style={styles.section}>
        <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
          Creates an empty folder with a bare SKILL.md. No template — you write the skill.
        </Text>
        <Card style={styles.card}>
          <View style={styles.field}>
            <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
              Name
            </Text>
            <Input
              value={name}
              onChangeText={setName}
              placeholder="my-skill"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              accessibilityLabel="Skill name"
            />
            <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
              Lowercase letters, digits and dashes. A same-named skill in the repository overrides
              this one in sessions.
            </Text>
          </View>
        </Card>
        <Button
          label="Create skill"
          stretch
          loading={busy}
          disabled={!valid || busy}
          onPress={() => void handleCreate()}
        />
        {failure === null ? null : (
          <Text size={ETextRole.Sm} tone={ETextTone.Destructive}>
            {failure}
          </Text>
        )}
      </View>
    </SettingsScroll>
  )
}

const styles = StyleSheet.create({
  section: {
    gap: space(3),
  },
  card: {
    gap: space(2),
  },
  field: {
    gap: space(1.5),
  },
})
