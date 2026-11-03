import type { SemanticTheme } from '@dltech/atlas-ui/tokens'
import { ActivityIndicator, StyleSheet, View } from 'react-native'

import { useTheme } from '../theme/use-theme'
import { ESessionStatus } from './session-status'

const colorOf = ({ status, theme }: { status: ESessionStatus; theme: SemanticTheme }): string => {
  if (status === ESessionStatus.Awaiting) return theme.warning
  if (status === ESessionStatus.Failed) return theme.destructive
  if (status === ESessionStatus.Idle) return theme.primary
  return theme.mutedForeground
}

export const StatusGlyph = ({ status }: { status: ESessionStatus }) => {
  const theme = useTheme()
  if (status === ESessionStatus.Running || status === ESessionStatus.Starting) {
    return <ActivityIndicator size="small" color={theme.primary} style={styles.box} />
  }
  const color = colorOf({ status, theme })
  const solid = status === ESessionStatus.Awaiting || status === ESessionStatus.Failed
  return (
    <View style={styles.box}>
      <View
        style={[styles.ring, { borderColor: color }, solid ? { backgroundColor: color } : null]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  ring: {
    borderRadius: 7,
    borderWidth: 2,
    height: 14,
    width: 14,
  },
})
