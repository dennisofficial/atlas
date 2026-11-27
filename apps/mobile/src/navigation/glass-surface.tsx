import { useTheme } from '@dltech/atlas-ui-native'
import { type GlassViewProps, GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'
import type { ReactNode } from 'react'
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'

export const GlassSurface = ({
  children,
  style,
  materialized,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  materialized?: boolean
}) => {
  const theme = useTheme()
  if (isLiquidGlassAvailable()) {
    const glassEffectStyle: GlassViewProps['glassEffectStyle'] =
      materialized === undefined
        ? 'regular'
        : { style: materialized ? 'regular' : 'none', animate: true }
    return (
      <GlassView glassEffectStyle={glassEffectStyle} style={style}>
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
