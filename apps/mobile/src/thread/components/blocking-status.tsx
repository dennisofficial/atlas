import {
  BLOCKING_SEND_NOTE,
  type BlockingCommand,
  elapsedClockOf,
} from '@dltech/atlas-client/stream'
import { EFontFamily, ETextRole, ETextTone, Text, useTheme } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { useCallback, useEffect, useState } from 'react'
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { COMPOSER_FIELD_BORDER, COMPOSER_INSET } from '../composer/composer-shape'
import {
  HIDDEN_STATUS,
  presenceOf,
  STATUS_HIDE_MS,
  STATUS_SHOW_MS,
  settledPresenceOf,
  statusExtentOf,
  statusLabelOf,
  statusOpacityOf,
} from './blocking-status-model'
import { useReduceMotion } from './use-reduce-motion'

const PULSE_MS = 1_200

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

const StatusLines = ({
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

  useEffect(() => {
    if (height === 0) {
      if (leaving) onLeft()
      return
    }
    if (!leaving) {
      shown.value = withTiming(1, { duration: STATUS_SHOW_MS, easing: Easing.out(Easing.cubic) })
      return
    }
    shown.value = withTiming(
      0,
      { duration: STATUS_HIDE_MS, easing: Easing.inOut(Easing.quad) },
      (finished) => {
        if (finished) scheduleOnRN(onLeft)
      },
    )
  }, [height, leaving, onLeft, shown])

  const roomStyle = useAnimatedStyle(() => ({
    height: statusExtentOf({ height, shown: shown.value, reduced }),
  }))
  const linesStyle = useAnimatedStyle(() => ({
    opacity: statusOpacityOf({ shown: shown.value, reduced }),
  }))
  const handleLayout = (event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height)

  return (
    <Animated.View style={[styles.room, roomStyle]} pointerEvents="none">
      <Animated.View
        accessible
        accessibilityLabel={statusLabelOf({ command, now })}
        onLayout={handleLayout}
        style={[styles.lines, linesStyle]}
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
    </Animated.View>
  )
}

export const BlockingStatus = ({
  command,
  now,
}: {
  command: BlockingCommand | undefined
  now: number
}) => {
  const [presence, setPresence] = useState(HIDDEN_STATUS)
  useEffect(() => {
    setPresence((current) => presenceOf({ presence: current, command }))
  }, [command])
  const handleLeft = useCallback(() => setPresence(settledPresenceOf), [])
  if (presence.command === undefined) return null
  return (
    <StatusLines
      command={presence.command}
      leaving={presence.leaving}
      now={now}
      onLeft={handleLeft}
    />
  )
}

const DOT = 8

const styles = StyleSheet.create({
  room: {
    overflow: 'hidden',
  },
  lines: {
    paddingHorizontal: COMPOSER_INSET + COMPOSER_FIELD_BORDER,
    paddingTop: space(3),
  },
  head: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: space(2),
  },
  pulse: {
    alignItems: 'center',
    height: DOT,
    justifyContent: 'center',
    width: DOT,
  },
  halo: {
    borderRadius: DOT / 2,
    height: DOT,
    position: 'absolute',
    width: DOT,
  },
  dot: {
    borderRadius: DOT / 2,
    height: DOT,
    width: DOT,
  },
  label: {
    flexShrink: 1,
  },
  clock: {
    fontVariant: ['tabular-nums'],
    marginLeft: 'auto',
  },
  note: {
    paddingLeft: DOT + space(2),
    paddingTop: space(0.5),
  },
})
