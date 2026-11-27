import {
  BLOCKING_SEND_NOTE,
  type BlockingCommand,
  elapsedClockOf,
} from '@dltech/atlas-client/stream'
import { EFontFamily, ETextRole, ETextTone, Text, useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { isLiquidGlassAvailable } from 'expo-glass-effect'
import { useCallback, useEffect, useState } from 'react'
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { GlassSurface } from '../../navigation/glass-surface'
import { COMPOSER_INSET, COMPOSER_RADIUS } from '../composer/composer-shape'
import {
  HIDDEN_STRIP,
  presenceOf,
  STRIP_RISE_SPRING,
  STRIP_SINK_MS,
  STRIP_TUCK,
  settledPresenceOf,
  stripLabelOf,
  stripRiseOf,
} from './blocking-strip-model'
import { useReduceMotion } from './use-reduce-motion'

const PULSE_MS = 1_200
const COMPOSER_DOCK_TOP = space(2)

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

const StripCard = ({
  command,
  leaving,
  now,
  onLeft,
}: {
  command: BlockingCommand
  leaving: boolean
  now: number
  onLeft: () => void
}) => {
  const theme = useTheme()
  const reduced = useReduceMotion()
  const [height, setHeight] = useState(0)
  const shown = useSharedValue(0)
  const rise = stripRiseOf({ height, reduced })
  const glass = isLiquidGlassAvailable()

  useEffect(() => {
    if (leaving && height === 0) {
      onLeft()
      return
    }
    if (height === 0) return
    if (leaving) {
      shown.value = withTiming(
        0,
        { duration: STRIP_SINK_MS, easing: Easing.in(Easing.quad) },
        (finished) => {
          if (finished) scheduleOnRN(onLeft)
        },
      )
      return
    }
    shown.value = withSpring(1, STRIP_RISE_SPRING)
  }, [height, leaving, onLeft, shown])

  const cardStyle = useAnimatedStyle(() => ({
    opacity: glass ? 1 : Math.min(shown.value, 1),
    transform: [{ translateY: (1 - shown.value) * rise }],
  }))
  const contentStyle = useAnimatedStyle(() => ({ opacity: Math.min(shown.value, 1) }))
  const handleLayout = (event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height)

  return (
    <View style={styles.slot} onLayout={handleLayout} pointerEvents="none">
      <Animated.View style={cardStyle}>
        <GlassSurface materialized={!leaving && height > 0} style={styles.card}>
          <Animated.View
            accessible
            accessibilityLabel={stripLabelOf({ command, now })}
            style={contentStyle}
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
                {elapsedClockOf({ startedAt: command.startedAt, now })}
              </Text>
            </View>
            <Text size={ETextRole.Xs} tone={ETextTone.Muted} numberOfLines={1} style={styles.note}>
              {BLOCKING_SEND_NOTE}
            </Text>
          </Animated.View>
        </GlassSurface>
      </Animated.View>
    </View>
  )
}

export const BlockingStrip = ({
  command,
  now,
}: {
  command: BlockingCommand | undefined
  now: number
}) => {
  const [presence, setPresence] = useState(HIDDEN_STRIP)
  useEffect(() => {
    setPresence((current) => presenceOf({ presence: current, command }))
  }, [command])
  const handleLeft = useCallback(() => setPresence(settledPresenceOf), [])
  if (presence.command === undefined) return null
  return (
    <StripCard
      command={presence.command}
      leaving={presence.leaving}
      now={now}
      onLeft={handleLeft}
    />
  )
}

const styles = StyleSheet.create({
  slot: {
    marginBottom: -(COMPOSER_DOCK_TOP + STRIP_TUCK),
    paddingHorizontal: space(4),
  },
  card: {
    borderCurve: 'continuous',
    borderRadius: COMPOSER_RADIUS,
    paddingBottom: STRIP_TUCK + space(2.5),
    paddingHorizontal: COMPOSER_INSET + space(1),
    paddingTop: space(3),
  },
  head: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
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
    paddingLeft: space(4),
    paddingTop: space(0.5),
  },
})
