import { useTheme } from '@dltech/atlas-ui-native'
import { radius } from '@dltech/atlas-ui/tokens'
import { Zap } from 'lucide-react-native'
import { Pressable, StyleSheet } from 'react-native'

import type { IModelSelection } from './model-options'
import { COMPOSER_TRIGGER_INSET } from '../thread/composer/composer-shape'

export const FastToggle = ({
  selection,
  onToggle,
}: {
  selection: IModelSelection
  onToggle: (fast: boolean) => void
}) => {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel="Fast"
      accessibilityState={{ checked: selection.fast }}
      onPress={() => onToggle(!selection.fast)}
      style={({ pressed }) => [styles.trigger, pressed ? { backgroundColor: theme.muted } : null]}
    >
      <Zap
        size={14}
        strokeWidth={2}
        color={selection.fast ? theme.foreground : theme.mutedForeground}
        fill={selection.fast ? theme.foreground : 'none'}
      />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  trigger: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    flexDirection: 'row',
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: COMPOSER_TRIGGER_INSET,
  },
})
