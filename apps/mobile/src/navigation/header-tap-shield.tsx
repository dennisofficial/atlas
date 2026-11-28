import { Platform, StyleSheet } from 'react-native'
import { NativeTouchControl } from 'react-native-touch-control'

export const HeaderTapShield = ({ slop = 0 }: { slop?: number }) => {
  if (Platform.OS !== 'ios') return null
  return (
    <NativeTouchControl
      style={[StyleSheet.absoluteFill, { top: -slop, right: -slop, bottom: -slop, left: -slop }]}
    />
  )
}

const styles = StyleSheet.create({
  passThrough: { pointerEvents: 'none' },
})

export const PASS_THROUGH = styles.passThrough
