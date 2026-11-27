import { ETextRole, ETextTone, Text, useTheme } from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { Pressable, StyleSheet } from 'react-native'

import { type IModelOption, type IModelSelection, modelTriggerLabelOf } from './model-options'

export const ModelTrigger = ({
  models,
  selection,
  pinnedRef,
  expanded = false,
  onPress,
}: {
  models: readonly IModelOption[]
  selection: IModelSelection | null
  pinnedRef?: string | null | undefined
  expanded?: boolean | undefined
  onPress: () => void
}) => {
  const theme = useTheme()
  const label = modelTriggerLabelOf({ models, selection, ref: pinnedRef })

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Model: ${label}`}
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.trigger,
        pressed || expanded ? { backgroundColor: theme.muted } : null,
      ]}
    >
      <Text size={ETextRole.Sm} tone={ETextTone.Muted} numberOfLines={1} style={styles.value}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  trigger: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    flexDirection: 'row',
    height: 28,
    maxWidth: 200,
    paddingHorizontal: space(2),
  },
  value: {
    flexShrink: 1,
  },
})
