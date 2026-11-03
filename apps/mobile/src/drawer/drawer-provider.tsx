import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler'
import Animated, {
  clamp,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'

import { useTheme } from '@dltech/atlas-ui-native'

const SPRING = { damping: 26, stiffness: 260, mass: 0.9, overshootClamping: true }
const FLING_VELOCITY = 0.6
const MAX_WIDTH = 320
const WIDTH_RATIO = 0.82
const SCRIM_OPACITY = 0.45

interface IDrawerContext {
  open: () => void
  close: () => void
}

const DrawerContext = createContext<IDrawerContext | undefined>(undefined)

export const useDrawer = (): IDrawerContext => {
  const context = useContext(DrawerContext)
  if (context === undefined) throw new Error('useDrawer must be used inside DrawerProvider')
  return context
}

export const DrawerProvider = ({
  drawer,
  swipeEnabled,
  children,
}: {
  drawer: ReactNode
  swipeEnabled: boolean
  children: ReactNode
}) => {
  const theme = useTheme()
  const { width } = useWindowDimensions()
  const drawerWidth = Math.min(MAX_WIDTH, Math.round(width * WIDTH_RATIO))
  const progress = useSharedValue(0)
  const startedAt = useSharedValue(0)
  const [isOpen, setIsOpen] = useState(false)

  const settle = useCallback(
    (target: 0 | 1) => {
      progress.value = withSpring(target, SPRING)
      setIsOpen(target === 1)
    },
    [progress],
  )

  const pan = usePanGesture({
    enabled: swipeEnabled || isOpen,
    activeOffsetX: [-12, 12],
    failOffsetY: [-12, 12],
    onBegin: () => {
      'worklet'
      startedAt.value = progress.value
    },
    onUpdate: (event) => {
      'worklet'
      progress.value = clamp(startedAt.value + event.translationX / drawerWidth, 0, 1)
    },
    onDeactivate: (event) => {
      'worklet'
      const velocity = event.velocityX / drawerWidth
      const flung = Math.abs(velocity) > FLING_VELOCITY
      const target = (flung ? velocity > 0 : progress.value > 0.5) ? 1 : 0
      progress.value = withSpring(target, { ...SPRING, velocity })
      scheduleOnRN(setIsOpen, target === 1)
    },
  })

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (progress.value - 1) * drawerWidth }],
  }))
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value * SCRIM_OPACITY }))

  const context = useMemo(() => ({ open: () => settle(1), close: () => settle(0) }), [settle])

  return (
    <DrawerContext.Provider value={context}>
      <GestureDetector gesture={pan}>
        <View style={styles.root}>
          {children}
          <Animated.View
            pointerEvents={isOpen ? 'auto' : 'none'}
            style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}
          >
            <Pressable
              accessibilityLabel="Close menu"
              style={StyleSheet.absoluteFill}
              onPress={context.close}
            />
          </Animated.View>
          <Animated.View
            accessibilityViewIsModal={isOpen}
            style={[
              styles.panel,
              {
                width: drawerWidth,
                backgroundColor: theme.sidebar,
                borderColor: theme.sidebarBorder,
              },
              panelStyle,
            ]}
          >
            {drawer}
          </Animated.View>
        </View>
      </GestureDetector>
    </DrawerContext.Provider>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrim: {
    backgroundColor: '#000',
  },
  panel: {
    borderRightWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
  },
})
