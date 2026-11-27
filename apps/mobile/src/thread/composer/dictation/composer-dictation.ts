import type { SharedValue } from 'react-native-reanimated'

export interface IComposerDictation {
  active: boolean
  history: SharedValue<readonly number[]>
  onStart: () => void
  onStop: () => void
}
