import { ETextRole, Icon, Text, useTheme } from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { ChevronDown } from 'lucide-react-native'
import { Pressable, StyleSheet } from 'react-native'

import { type IModelOption, type IModelSelection, modelTriggerLabelOf } from './model-options'
import { ProviderMark } from './model-picker-rows'

export const ModelTrigger = ({
  models,
  selection,
  onPress,
}: {
  models: readonly IModelOption[]
  selection: IModelSelection | null
  onPress: () => void
}) => {
  const theme = useTheme()
  const label = modelTriggerLabelOf({ models, selection })
  const model = selection?.model

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Model: ${label}`}
      onPress={onPress}
      style={({ pressed }) => [styles.trigger, pressed ? { backgroundColor: theme.muted } : null]}
    >
      {model === undefined ? null : <ProviderMark monogram={model.monogram} brand={model.brand} />}
      <Text size={ETextRole.Sm} numberOfLines={1} style={styles.value}>
        {label}
      </Text>
      <Icon icon={ChevronDown} color={theme.mutedForeground} size={16} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  trigger: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    flexDirection: 'row',
    gap: space(1.5),
    height: 28,
    maxWidth: 200,
    paddingHorizontal: space(2),
  },
  value: {
    flexShrink: 1,
  },
})
