import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import { useTheme } from '@dltech/atlas-ui-native'

import { EPaneLayout } from './pane-layout'
import { usePaneLayout } from './use-pane-layout'

export const SplitPanes = ({
  primary,
  secondary,
}: {
  primary: ReactNode
  secondary: ReactNode | null
}) => {
  const theme = useTheme()
  const layout = usePaneLayout()
  if (layout.kind === EPaneLayout.Single || secondary === null) {
    return <View style={styles.fill}>{primary}</View>
  }
  return (
    <View style={styles.row}>
      <View style={{ width: layout.primaryWidth }}>{primary}</View>
      <View style={[styles.secondary, { width: layout.secondaryWidth, borderColor: theme.border }]}>
        {secondary}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
  },
  secondary: {
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
})
