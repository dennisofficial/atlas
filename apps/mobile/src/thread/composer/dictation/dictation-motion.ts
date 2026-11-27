import {
  type EntryOrExitLayoutType,
  FadeIn,
  FadeInRight,
  FadeOut,
  FadeOutLeft,
  LinearTransition,
} from 'react-native-reanimated'

const DURATION = 240

const MOVE = LinearTransition.springify().damping(28).stiffness(300)

export interface IDictationMotion {
  entering: EntryOrExitLayoutType
  exiting: EntryOrExitLayoutType
}

export interface IComposerDictationMotion {
  attach: IDictationMotion
  slot: IDictationMotion
  trailing: IDictationMotion
  wave: IDictationMotion
  layout: EntryOrExitLayoutType
}

const swipeLeft = (): IDictationMotion => ({
  entering: FadeInRight.duration(DURATION),
  exiting: FadeOutLeft.duration(DURATION),
})

export const COMPOSER_DICTATION_MOTION: IComposerDictationMotion = {
  attach: swipeLeft(),
  slot: swipeLeft(),
  trailing: swipeLeft(),
  wave: { entering: FadeIn.duration(DURATION), exiting: FadeOut.duration(DURATION) },
  layout: MOVE,
}
