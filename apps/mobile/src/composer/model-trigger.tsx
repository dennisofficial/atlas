import { ETextRole, ETextTone, Text, useTheme } from '@dltech/atlas-ui-native'
import { radius } from '@dltech/atlas-ui/tokens'
import { Pressable, StyleSheet } from 'react-native'

import { type IModelOption, type IModelSelection, modelTriggerLabelOf } from './model-options'
import { COMPOSER_TRIGGER_INSET } from '../thread/composer/composer-shape'

export const ModelTrigger = ({
  models,
  selection,
  pinnedRef,
  onPress,
}: {
  models: readonly IModelOption[]
  selection: IModelSelection | null
  pinnedRef?: string | null | undefined
  onPress: () => void
}) => {
  const theme = useTheme()
  const label = modelTriggerLabelOf({ models, selection, ref: pinnedRef })

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Model: ${label}`}
      onPress={onPress}
      style={({ pressed }) => [styles.trigger, pressed ? { backgroundColor: theme.muted } : null]}
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
    paddingHorizontal: COMPOSER_TRIGGER_INSET,
  },
  value: {
    flexShrink: 1,
  },
})
