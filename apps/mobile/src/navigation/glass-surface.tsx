import { useTheme } from '@dltech/atlas-ui-native'
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'
import type { ReactNode } from 'react'
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'

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
      <GlassView glassEffectStyle="regular" style={style}>
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
  fallback: {
    borderWidth: StyleSheet.hairlineWidth,
  },
})
