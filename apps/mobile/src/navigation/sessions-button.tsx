import { useTheme } from '@dltech/atlas-ui-native'
import { SymbolView } from 'expo-symbols'
import { Pressable, StyleSheet } from 'react-native'

import { HeaderTapShield } from './header-tap-shield'

const HIT_SLOP = 8

export const SessionsButton = ({ onPress }: { onPress: () => void }) => {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityLabel="Sessions"
      accessibilityRole="button"
      hitSlop={HIT_SLOP}
      onPress={onPress}
      style={styles.button}
    >
      <SymbolView name="sidebar.left" size={22} tintColor={theme.foreground} />
      <HeaderTapShield slop={HIT_SLOP} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
  },
})
