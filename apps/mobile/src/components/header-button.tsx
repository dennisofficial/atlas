import type { AndroidSymbol, SFSymbol } from 'expo-symbols'
import { Pressable, StyleSheet } from 'react-native'

import { useTheme } from '../theme/use-theme'
import { Icon } from './icon'

export const HeaderButton = ({
  label,
  ios,
  web,
  filled = false,
  onPress,
}: {
  label: string
  ios: SFSymbol
  web: AndroidSymbol
  filled?: boolean
  onPress: () => void
}) => {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        filled ? { backgroundColor: theme.primary } : null,
        { opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Icon ios={ios} web={web} color={filled ? theme.primaryForeground : theme.foreground} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
})
