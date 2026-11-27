import type { ReactNode } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native'
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { dockPaddingOf } from './keyboard-inset'

export const KeyboardDock = ({
  children,
  style,
  overlay = false,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  overlay?: boolean
}) => {
  const { bottom } = useSafeAreaInsets()
  const { height } = useReanimatedKeyboardAnimation()
  const animatedStyle = useAnimatedStyle(
    () => ({ paddingBottom: dockPaddingOf({ keyboardHeight: height.value, safeBottom: bottom }) }),
    [bottom],
  )
  return (
    <Animated.View
      pointerEvents={overlay ? 'box-none' : 'auto'}
      style={[overlay ? styles.overlay : null, style, animatedStyle]}
    >
      {children}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
  },
})
