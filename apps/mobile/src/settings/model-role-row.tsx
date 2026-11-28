import { followNoteOf, roleTitleOf } from '@dltech/atlas-client/settings'
import { CardRow, ETextRole, ETextTone, Icon, Text, useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { refKey, type ModelRole, type ResolvedModelChoice } from '@dltech/atlas-core'
import { ChevronRight } from 'lucide-react-native'
import { Pressable, StyleSheet, View } from 'react-native'

import {
  effortLabelOf,
  modelTriggerLabelOf,
  type IModelOption,
  selectionOf,
} from '../composer/model-options'

export const ModelRoleRow = ({
  role,
  choice,
  models,
  following,
  onPress,
}: {
  role: ModelRole
  choice: ResolvedModelChoice
  models: readonly IModelOption[]
  following: boolean
  onPress: () => void
}) => {
  const theme = useTheme()
  const modelId = refKey(choice.ref)
  const selection = selectionOf({ models, modelId, effort: choice.effort, fast: choice.fast })
  const label = modelTriggerLabelOf({ models, selection, ref: modelId })
  const summary = `${label} · ${effortLabelOf(choice.effort)}${choice.fast ? ' · Fast' : ''}`
  const note = following ? followNoteOf(role) : undefined

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={roleTitleOf(role)} onPress={onPress}>
      <CardRow>
        <View style={styles.copy}>
          <Text size={ETextRole.Sm} numberOfLines={1}>
            {roleTitleOf(role)}
          </Text>
          {note === undefined ? null : (
            <Text size={ETextRole.Xs} tone={ETextTone.Muted} numberOfLines={1}>
              {note}
            </Text>
          )}
        </View>
        <View style={styles.trailing}>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted} numberOfLines={1} style={styles.summary}>
            {summary}
          </Text>
          <Icon icon={ChevronRight} color={theme.mutedForeground} size={16} />
        </View>
      </CardRow>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  copy: {
    flexShrink: 0,
    gap: space(1),
  },
  trailing: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: space(1),
    minWidth: 0,
  },
  summary: {
    flexShrink: 1,
    textAlign: 'right',
  },
})
