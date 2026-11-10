import { type ReactNode, useEffect } from 'react'
import { type KeyboardEventEasing, type StyleProp, type ViewStyle } from 'react-native'
import Animated, {
  Easing,
  type EasingFunction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useKeyboard } from './use-keyboard'

const EASING_OF: Record<KeyboardEventEasing, EasingFunction> = {
  easeIn: Easing.in(Easing.ease),
  easeInEaseOut: Easing.inOut(Easing.ease),
  easeOut: Easing.out(Easing.ease),
  linear: Easing.linear,
  keyboard: Easing.linear,
}

export const KeyboardDock = ({
  children,
  style,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) => {
  const insets = useSafeAreaInsets()
  const { duration, easing, inset } = useKeyboard()
  const target = inset > 0 ? inset : insets.bottom
  const padding = useSharedValue(target)

  useEffect(() => {
    padding.value = withTiming(target, { duration, easing: EASING_OF[easing] })
  }, [duration, easing, padding, target])

  const animatedStyle = useAnimatedStyle(() => ({ paddingBottom: padding.value }))

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
}
