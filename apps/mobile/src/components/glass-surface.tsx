import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'

import { useTheme } from '../theme/use-theme'

export const GlassSurface = ({
  children,
  style,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) => {
  const theme = useTheme()
  if (isLiquidGlassAvailable()) {
    return (
      <GlassView style={[styles.glass, style]} glassEffectStyle="regular">
        {children}
      </GlassView>
    )
  }
  return (
    <View
      style={[styles.fallback, { backgroundColor: theme.card, borderColor: theme.border }, style]}
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  glass: {
    borderRadius: 24,
    padding: 32,
  },
  fallback: {
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 32,
  },
})
