import { LoaderCircle } from 'lucide-react-native'
import { useEffect, useRef } from 'react'
import { Animated, Easing, Platform, StyleSheet } from 'react-native'

const TURN_MS = 1000

export const Spinner = ({ color, size = 16 }: { color: string; size?: number }) => {
  const turn = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(turn, {
        toValue: 1,
        duration: TURN_MS,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== 'web',
      }),
    )
    loop.start()
    return () => loop.stop()
  }, [turn])

  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      style={[styles.frame, { width: size, height: size, transform: [{ rotate }] }]}
    >
      <LoaderCircle size={size} color={color} strokeWidth={2} />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
})
