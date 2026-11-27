import type { SharedValue } from 'react-native-reanimated'

export enum EDictationTransition {
  SwipeLeft = 'swipe-left',
  SwipeLeftStaggered = 'swipe-left-staggered',
  SwipeDown = 'swipe-down',
}

export const DICTATION_TRANSITIONS: readonly {
  value: EDictationTransition
  title: string
}[] = [
  { value: EDictationTransition.SwipeLeft, title: 'Left' },
  { value: EDictationTransition.SwipeLeftStaggered, title: 'Left, then' },
  { value: EDictationTransition.SwipeDown, title: 'Down' },
]

export interface IComposerDictation {
  active: boolean
  transition: EDictationTransition
  history: SharedValue<readonly number[]>
  onStart: () => void
  onStop: () => void
}
