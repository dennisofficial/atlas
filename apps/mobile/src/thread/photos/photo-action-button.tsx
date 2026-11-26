import { useTheme } from '@dltech/atlas-ui-native'
import { type SFSymbol, SymbolView } from 'expo-symbols'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet } from 'react-native'

import { GlassSurface } from '../../navigation/glass-surface'

export const PHOTO_ACTION_SIZE = 44

export const PhotoActionButton = ({
  symbol,
  fallback,
  label,
  onPress,
}: {
  symbol: SFSymbol
  fallback: ReactNode
  label: string
  onPress: () => void
}) => {
  const theme = useTheme()
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={8} onPress={onPress}>
      <GlassSurface style={styles.button}>
        <SymbolView name={symbol} size={20} tintColor={theme.foreground} fallback={fallback} />
      </GlassSurface>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: PHOTO_ACTION_SIZE / 2,
    height: PHOTO_ACTION_SIZE,
    justifyContent: 'center',
    overflow: 'hidden',
    width: PHOTO_ACTION_SIZE,
  },
})
