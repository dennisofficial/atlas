import { useTheme } from '@dltech/atlas-ui-native'
import { type ReactNode, useEffect, useState } from 'react'
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

import { OVERLAY_ANIMATION_MS, OVERLAY_BACKDROP_ALPHA, overlayWidthOf } from './sessions-overlay'

export const SessionsOverlayLayer = ({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
}) => {
  const theme = useTheme()
  const { width } = useWindowDimensions()
  const panelWidth = overlayWidthOf(width)
  const progress = useSharedValue(open ? 1 : 0)
  const [mounted, setMounted] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
      progress.value = withTiming(1, { duration: OVERLAY_ANIMATION_MS })
      return
    }
    progress.value = withTiming(0, { duration: OVERLAY_ANIMATION_MS }, (finished) => {
      if (finished) runOnJS(setMounted)(false)
    })
  }, [open, progress])

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -(1 - progress.value) * panelWidth }],
  }))
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value * OVERLAY_BACKDROP_ALPHA,
  }))

  if (!mounted) return null

  return (
    <View style={styles.layer}>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close sessions"
          onPress={onClose}
          style={styles.fill}
        />
      </Animated.View>
      <Animated.View
        style={[styles.panel, { width: panelWidth, borderColor: theme.border }, panelStyle]}
      >
        {children}
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  layer: {
    bottom: 0,
    left: 0,
    pointerEvents: 'box-none',
    position: 'absolute',
    right: 0,
    top: 0,
  },
  backdrop: {
    backgroundColor: 'black',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  fill: {
    flex: 1,
  },
  panel: {
    borderRightWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
  },
})
