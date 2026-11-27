import {
  GROUP_INSTRUCTIONS_DESCRIPTION,
  INHERITED_INSTRUCTIONS_DESCRIPTION,
  type TInstructionsDoc,
} from '@dltech/atlas-client/settings'
import { EFontFamily, ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { GROUP_INSTRUCTION_CHAR_LIMIT } from '@dltech/atlas-wire/web'
import { router, useLocalSearchParams } from 'expo-router'
import { StyleSheet, View } from 'react-native'

import { useAuth } from '../../../../auth/auth-provider'
import { InstructionsEditor } from '../../../../settings/instructions-editor'
import {
  loadGroupInstructions,
  loadPersonalInstructions,
  saveGroupInstructions,
} from '../../../../settings/instructions-api'
import { SettingsScroll } from '../../../../settings/settings-scroll'
import { NavRow, Section, StatusRows } from '../../../../settings/settings-parts'
import { useApiResource } from '../../../../settings/use-api-resource'

export default function GroupInstructionsScreen() {
  const { api } = useAuth()
  const { groupId } = useLocalSearchParams<{ groupId: string }>()
  const group = useApiResource({
    load: () =>
      api === undefined
        ? Promise.resolve(null)
        : loadGroupInstructions({ api, groupId }).then(
            (doc): TInstructionsDoc => ({ text: doc.content, revision: 0 }),
          ),
    deps: [api, groupId],
  })
  const personal = useApiResource({
    load: () => (api === undefined ? Promise.resolve(null) : loadPersonalInstructions({ api })),
    deps: [api],
  })

  const handleSave = async ({ text }: { text: string; baseRevision: number }) => {
    if (api === undefined) throw new Error('The account is not signed in.')
    await saveGroupInstructions({ api, groupId, content: text })
    return { text, revision: 0 }
  }

  const personalText = personal.data?.text.trim() ?? ''

  return (
    <SettingsScroll>
      <StatusRows
        state={group.state}
        onRetry={group.reload}
        failure="These instructions could not be loaded."
      />
      {group.data === null ? null : (
        <>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            {GROUP_INSTRUCTIONS_DESCRIPTION}
          </Text>
          <InstructionsEditor
            doc={group.data}
            limit={GROUP_INSTRUCTION_CHAR_LIMIT}
            onSave={handleSave}
            inherited={
              personalText === '' ? null : (
                <Section title="From personal settings">
                  <View style={styles.inherited}>
                    <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
                      {INHERITED_INSTRUCTIONS_DESCRIPTION}
                    </Text>
                    <Text size={ETextRole.Sm} family={EFontFamily.Mono}>
                      {personalText}
                    </Text>
                  </View>
                  <NavRow
                    label="Edit personal instructions"
                    onPress={() => router.push('/settings/instructions')}
                  />
                </Section>
              )
            }
          />
        </>
      )}
    </SettingsScroll>
  )
}

const styles = StyleSheet.create({
  inherited: {
    gap: space(2),
    paddingHorizontal: space(3),
    paddingVertical: space(2),
  },
})
