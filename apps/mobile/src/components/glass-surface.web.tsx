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
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 32,
  },
})
