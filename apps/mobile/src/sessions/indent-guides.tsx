import { useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import { INDENT_PER_DEPTH, guideOffsetsOf } from './indent-layout'

export const IndentGuides = ({ depth, children }: { depth: number; children: ReactNode }) => {
  const theme = useTheme()
  if (depth <= 0) return children
  return (
    <View style={[styles.frame, { paddingLeft: depth * INDENT_PER_DEPTH }]}>
      {guideOffsetsOf(depth).map((left) => (
        <View
          key={left}
          pointerEvents="none"
          style={[styles.guide, { left, backgroundColor: theme.sidebarBorder }]}
        />
      ))}
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  frame: {
    position: 'relative',
  },
  guide: {
    bottom: -space(0.5),
    position: 'absolute',
    top: 0,
    width: StyleSheet.hairlineWidth * 2,
  },
})
