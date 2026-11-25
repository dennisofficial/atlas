import { useTheme } from '@dltech/atlas-ui-native'
import { SymbolView } from 'expo-symbols'
import { Pressable, StyleSheet } from 'react-native'

export const SessionsButton = ({ onPress }: { onPress: () => void }) => {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityLabel="Sessions"
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={styles.button}
    >
      <SymbolView name="sidebar.left" size={22} tintColor={theme.foreground} />
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
