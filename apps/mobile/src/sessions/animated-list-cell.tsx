import { type ReactNode, useEffect, useMemo, useRef } from 'react'
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native'
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated'

import { freshKeysOf } from './fresh-keys'

const MOVE = LinearTransition.springify().mass(1).stiffness(320).damping(32)
const ENTER = FadeIn.duration(220)
const EXIT = FadeOut.duration(180)

export const AnimatedListCell = ({
  children,
  onLayout,
  style,
}: {
  children?: ReactNode
  onLayout?: (event: LayoutChangeEvent) => void
  style?: StyleProp<ViewStyle>
}) => (
  <Animated.View layout={MOVE} onLayout={onLayout} style={style}>
    {children}
  </Animated.View>
)

export const AnimatedListItem = ({ fresh, children }: { fresh: boolean; children: ReactNode }) => (
  <Animated.View entering={fresh ? ENTER : undefined} exiting={EXIT}>
    {children}
  </Animated.View>
)

export const useFreshKeys = (keys: readonly string[]): ReadonlySet<string> => {
  const previous = useRef<ReadonlySet<string>>(new Set())
  const fresh = useMemo(() => freshKeysOf({ previous: previous.current, next: keys }), [keys])
  useEffect(() => {
    previous.current = new Set(keys)
  }, [keys])
  return fresh
}
