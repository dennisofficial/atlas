import {
  BLOCKING_SEND_NOTE,
  type BlockingCommand,
  elapsedClockOf,
} from '@dltech/atlas-client/stream'
import {
  EFontFamily,
  ETextRole,
  ETextTone,
  Text,
  useTheme,
  withAlpha,
} from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { useEffect, useState } from 'react'
import { AccessibilityInfo, type LayoutChangeEvent, StyleSheet, View } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

const PULSE_MS = 1_200
const SHIMMER_MS = 2_200

const useReduceMotion = (): boolean => {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    let live = true
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (live) setReduced(enabled)
    })
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced)
    return () => {
      live = false
      subscription.remove()
    }
  }, [])
  return reduced
}

const Pulse = ({ reduced, color }: { reduced: boolean; color: string }) => {
  const progress = useSharedValue(0)
  useEffect(() => {
    if (reduced) {
      cancelAnimation(progress)
      progress.value = 0
      return undefined
    }
    progress.value = withRepeat(
      withTiming(1, { duration: PULSE_MS, easing: Easing.out(Easing.quad) }),
      -1,
      false,
    )
    return () => cancelAnimation(progress)
  }, [progress, reduced])
  const halo = useAnimatedStyle(() => ({
    opacity: 0.45 * (1 - progress.value),
    transform: [{ scale: 1 + progress.value * 1.8 }],
  }))
  return (
    <View style={styles.pulse}>
      {reduced ? null : <Animated.View style={[styles.halo, { backgroundColor: color }, halo]} />}
      <View style={[styles.dot, { backgroundColor: color }]} />
    </View>
  )
}

const Shimmer = ({ reduced, color, track }: { reduced: boolean; color: string; track: string }) => {
  const [width, setWidth] = useState(0)
  const progress = useSharedValue(0)
  useEffect(() => {
    if (reduced || width === 0) {
      cancelAnimation(progress)
      progress.value = 0
      return undefined
    }
    progress.value = withRepeat(withTiming(1, { duration: SHIMMER_MS, easing: Easing.linear }), -1)
    return () => cancelAnimation(progress)
  }, [progress, reduced, width])
  const glow = useAnimatedStyle(() => ({
    opacity: reduced ? 0 : 0.7,
    transform: [{ translateX: -width * 0.35 + progress.value * width }],
  }))
  const handleLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)
  return (
    <View style={[styles.track, { backgroundColor: track }]} onLayout={handleLayout}>
      <Animated.View style={[styles.glow, { backgroundColor: color }, glow]} />
    </View>
  )
}

export const BlockingStrip = ({ command, now }: { command: BlockingCommand; now: number }) => {
  const theme = useTheme()
  const reduced = useReduceMotion()
  const clock = elapsedClockOf({ startedAt: command.startedAt, now })
  return (
    <View style={styles.slot}>
      <View
        accessible
        accessibilityLabel={`${command.copy.label}, ${clock}. ${BLOCKING_SEND_NOTE}`}
        style={[styles.strip, { backgroundColor: theme.card, borderColor: theme.input }]}
      >
        <View style={styles.head}>
          <Pulse reduced={reduced} color={theme.primary} />
          <Text size={ETextRole.Xs} numberOfLines={1} style={styles.label}>
            {command.copy.label}
          </Text>
          <Text
            size={ETextRole.Xs}
            family={EFontFamily.Mono}
            tone={ETextTone.Muted}
            style={styles.clock}
          >
            {clock}
          </Text>
        </View>
        <Text size={ETextRole.Xs} tone={ETextTone.Muted} numberOfLines={1} style={styles.note}>
          {BLOCKING_SEND_NOTE}
        </Text>
        <Shimmer
          reduced={reduced}
          color={theme.primary}
          track={withAlpha({ color: theme.foreground, alpha: 0.08 })}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  slot: {
    paddingHorizontal: space(4),
  },
  strip: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderTopLeftRadius: radius(1),
    borderTopRightRadius: radius(1),
    borderWidth: 1,
    overflow: 'hidden',
  },
  head: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
    paddingHorizontal: space(3),
    paddingTop: space(2),
    paddingBottom: space(1),
  },
  pulse: {
    alignItems: 'center',
    height: 8,
    justifyContent: 'center',
    width: 8,
  },
  halo: {
    borderRadius: 4,
    height: 8,
    position: 'absolute',
    width: 8,
  },
  dot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  label: {
    flexShrink: 1,
  },
  clock: {
    fontVariant: ['tabular-nums'],
    marginLeft: 'auto',
  },
  note: {
    paddingBottom: space(2),
    paddingHorizontal: space(3),
    paddingLeft: space(7),
  },
  track: {
    height: 2,
    overflow: 'hidden',
    width: '100%',
  },
  glow: {
    bottom: 0,
    position: 'absolute',
    top: 0,
    width: '35%',
  },
})
