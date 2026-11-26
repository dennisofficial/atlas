import type { ReactNode } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { dockPaddingOf } from './keyboard-inset'

export const KeyboardDock = ({
  children,
  style,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) => {
  const { bottom } = useSafeAreaInsets()
  const { height } = useReanimatedKeyboardAnimation()
  const animatedStyle = useAnimatedStyle(
    () => ({ paddingBottom: dockPaddingOf({ keyboardHeight: height.value, safeBottom: bottom }) }),
    [bottom],
  )
  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
}
