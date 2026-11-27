import {
  CONTEXT_FIELDS,
  IMAGE_MODEL_ITEMS,
  ROUTINE_TIMEZONE_KEY,
  agentSettingsChanges,
  agentSettingsFrom,
  fieldChanges,
  fieldValuesFrom,
  routineSettingsFrom,
} from '@dltech/atlas-client/settings'
import { CardRow, ETextRole, ETextTone, Input, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import type { SettingScalar } from '@dltech/atlas-wire/web'
import { StyleSheet, View } from 'react-native'

import { ChoiceRow } from '../../../settings/choice-row'
import { Section } from '../../../settings/settings-parts'
import { SettingFieldRows } from '../../../settings/setting-field-rows'
import { SettingsScroll } from '../../../settings/settings-scroll'
import { useSettings } from '../../../settings/settings-provider'

const deviceZoneOf = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

export default function AgentScreen() {
  const settings = useSettings()
  const agent = agentSettingsFrom(settings.values)
  const fields = fieldValuesFrom({ fields: CONTEXT_FIELDS, values: settings.values })
  const routine = routineSettingsFrom(settings.values)

  const handleImageModel = (next: (typeof agent)['imageModel']) => {
    void settings
      .save(agentSettingsChanges({ saved: agent, draft: { ...agent, imageModel: next } }))
      .catch(() => undefined)
  }

  const handleField = (args: { key: string; next: SettingScalar }) => {
    void settings
      .save(fieldChanges({ saved: fields, draft: { ...fields, [args.key]: args.next } }))
      .catch(() => undefined)
  }

  const handleZone = (text: string) => {
    if (text === routine.timezone) return
    void settings
      .save({
        [ROUTINE_TIMEZONE_KEY]: text,
      })
      .catch(() => undefined)
  }

  return (
    <SettingsScroll>
      <Section title="Images">
        <ChoiceRow
          label="Image model"
          detail="The model image_generate uses when the agent names none. Only models that support Zero Data Retention are listed."
          value={agent.imageModel}
          options={IMAGE_MODEL_ITEMS}
          onChange={handleImageModel}
        />
      </Section>
      <Section title="Context and skills">
        <SettingFieldRows fields={CONTEXT_FIELDS} value={fields} onChange={handleField} />
      </Section>
      <Section title="Routines">
        <CardRow>
          <View style={styles.copy}>
            <Text size={ETextRole.Sm}>Default timezone</Text>
            <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
              New routines open in this zone. Empty means this device&apos;s zone.
            </Text>
          </View>
          <Input
            accessibilityLabel="Default timezone"
            key={routine.timezone}
            defaultValue={routine.timezone}
            placeholder={deviceZoneOf()}
            autoCapitalize="none"
            autoCorrect={false}
            onEndEditing={(event) => handleZone(event.nativeEvent.text)}
            style={styles.input}
          />
        </CardRow>
      </Section>
    </SettingsScroll>
  )
}

const styles = StyleSheet.create({
  copy: {
    flexShrink: 1,
    gap: space(1),
  },
  input: {
    minWidth: 140,
  },
})
