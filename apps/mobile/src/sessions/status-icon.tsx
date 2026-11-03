import { Icon, useTheme, withAlpha } from '@dltech/atlas-ui-native'
import {
  Circle,
  CircleAlert,
  CircleDashed,
  CircleX,
  LoaderCircle,
  type LucideIcon,
} from 'lucide-react-native'
import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import { ESessionStatus } from './session-status'

const Spinning = ({ children }: { children: React.ReactNode }) => {
  const turn = useSharedValue(0)
  useEffect(() => {
    turn.value = withRepeat(withTiming(360, { duration: 1000, easing: Easing.linear }), -1)
    return () => cancelAnimation(turn)
  }, [turn])
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }))
  return <Animated.View style={style}>{children}</Animated.View>
}

export const StatusIcon = ({ status, unread }: { status: ESessionStatus; unread: boolean }) => {
  const theme = useTheme()
  const glyph = (icon: LucideIcon, color: string) => <Icon icon={icon} color={color} size={16} />
  const body = (() => {
    if (status === ESessionStatus.Running)
      return <Spinning>{glyph(LoaderCircle, theme.primary)}</Spinning>
    if (status === ESessionStatus.Starting)
      return <Spinning>{glyph(CircleDashed, theme.mutedForeground)}</Spinning>
    if (status === ESessionStatus.Awaiting) return glyph(CircleAlert, theme.warning)
    if (status === ESessionStatus.Failed) return glyph(CircleX, theme.destructive)
    if (status === ESessionStatus.Parked) {
      return glyph(CircleDashed, withAlpha({ color: theme.mutedForeground, alpha: 0.6 }))
    }
    return glyph(Circle, theme.foreground)
  })()
  return (
    <View style={styles.box}>
      {body}
      {unread ? <View style={[styles.dot, { backgroundColor: theme.primary }]} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    height: 16,
    justifyContent: 'center',
    width: 16,
  },
  dot: {
    borderRadius: 3,
    height: 6,
    position: 'absolute',
    width: 6,
  },
})
