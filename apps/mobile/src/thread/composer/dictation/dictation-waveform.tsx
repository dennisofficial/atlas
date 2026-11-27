import { StyleSheet, View } from 'react-native'
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated'

import { isSilentOf, WAVEFORM_SIZE } from './waveform-history'

const BAR_WIDTH = 2

const MIN_BAR_HEIGHT = 3

const MAX_BAR_HEIGHT = 22

const SILENT_OPACITY = 0.3

const LOUD_OPACITY = 0.95

const WaveBar = ({
  history,
  index,
  color,
}: {
  history: SharedValue<readonly number[]>
  index: number
  color: string
}) => {
  const style = useAnimatedStyle(() => {
    const level = history.value[index] ?? 0
    return {
      height: Math.max(MIN_BAR_HEIGHT, level * MAX_BAR_HEIGHT),
      opacity: isSilentOf(level) ? SILENT_OPACITY : LOUD_OPACITY,
    }
  })
  return <Animated.View style={[styles.bar, { backgroundColor: color }, style]} />
}

export const DictationWaveform = ({
  history,
  color,
}: {
  history: SharedValue<readonly number[]>
  color: string
}) => (
  <View style={styles.row}>
    {Array.from({ length: WAVEFORM_SIZE }, (_, index) => (
      <WaveBar key={index} history={history} index={index} color={color} />
    ))}
  </View>
)

const styles = StyleSheet.create({
  bar: {
    borderRadius: 999,
    width: BAR_WIDTH,
  },
  row: {
    alignItems: 'center',
    alignSelf: 'stretch',
    flexDirection: 'row',
    height: MAX_BAR_HEIGHT,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
})
