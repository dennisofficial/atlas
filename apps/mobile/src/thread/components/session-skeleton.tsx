import { useTheme } from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { type ReactNode, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

const Pulse = ({ children }: { children: ReactNode }) => {
  const level = useSharedValue(0.5)
  useEffect(() => {
    level.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    )
    return () => cancelAnimation(level)
  }, [level])
  const style = useAnimatedStyle(() => ({ opacity: level.value }))
  return <Animated.View style={style}>{children}</Animated.View>
}

const Bar = ({ width, height = 10 }: { width: string; height?: number }) => {
  const theme = useTheme()
  return <View style={[styles.bar, { backgroundColor: theme.muted, height, width }]} />
}

export const SessionSkeleton = () => (
  <Pulse>
    <View
      accessible
      accessibilityLabel="Loading this session"
      accessibilityRole="progressbar"
      style={styles.content}
    >
      <View style={styles.item}>
        <Bar width="54%" height={8} />
      </View>
      <View style={styles.item}>
        <Bar width="72%" />
        <Bar width="88%" />
        <Bar width="46%" />
      </View>
      <View style={styles.item}>
        <Bar width="38%" height={8} />
        <Bar width="62%" height={8} />
      </View>
      <View style={styles.item}>
        <Bar width="80%" />
        <Bar width="64%" />
      </View>
    </View>
  </Pulse>
)

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: space(4),
    paddingTop: space(4),
  },
  item: {
    gap: space(2),
    paddingVertical: space(3),
  },
  bar: {
    borderRadius: radius(0.5),
  },
})
