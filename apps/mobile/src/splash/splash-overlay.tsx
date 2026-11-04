import { Image } from 'expo-image'
import * as SplashScreen from 'expo-splash-screen'
import { useEffect, useState } from 'react'
import { StyleSheet } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

const SPLASH_BACKGROUND = '#fbf7f2'
const MARK_WIDTH = 120
const MARK_ASPECT = 1024 / 830
const mark = require('../../assets/images/splash-icon.png')

export const SplashOverlay = ({ ready }: { ready: boolean }) => {
  const [done, setDone] = useState(false)
  const progress = useSharedValue(0)

  useEffect(() => {
    if (!ready) return
    SplashScreen.hide()
    progress.value = withDelay(
      80,
      withTiming(1, { duration: 520, easing: Easing.bezier(0.6, 0, 0.2, 1) }, (finished) => {
        if (finished) scheduleOnRN(setDone, true)
      }),
    )
  }, [ready, progress])

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value < 0.45 ? 1 : 1 - (progress.value - 0.45) / 0.55,
  }))
  const markStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{ scale: 1 - 0.12 * Math.min(progress.value * 3, 1) + 2.4 * progress.value ** 3 }],
  }))

  if (done) return null
  return (
    <Animated.View pointerEvents="none" style={[styles.backdrop, backdropStyle]}>
      <Animated.View style={markStyle}>
        <Image source={mark} style={styles.mark} contentFit="contain" />
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    backgroundColor: SPLASH_BACKGROUND,
    justifyContent: 'center',
  },
  mark: {
    height: MARK_WIDTH / MARK_ASPECT,
    width: MARK_WIDTH,
  },
})
