import {
  type EntryOrExitLayoutType,
  FadeIn,
  FadeInRight,
  FadeInUp,
  FadeOut,
  FadeOutDown,
  FadeOutLeft,
  LinearTransition,
} from 'react-native-reanimated'

import { EDictationTransition } from './composer-dictation'

const DURATION = 240

const STAGGER_MS = 60

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

const swipeDownOf = (): IComposerDictationMotion => ({
  attach: { entering: FadeInUp.duration(DURATION), exiting: FadeOutDown.duration(DURATION) },
  slot: { entering: FadeInUp.duration(DURATION), exiting: FadeOutDown.duration(DURATION) },
  trailing: { entering: FadeInUp.duration(DURATION), exiting: FadeOutDown.duration(DURATION) },
  wave: { entering: FadeIn.duration(DURATION), exiting: FadeOut.duration(DURATION) },
  layout: MOVE,
})

const swipeLeftOf = ({ staggered }: { staggered: boolean }): IComposerDictationMotion => {
  const slotDelay = staggered ? STAGGER_MS : 0
  const waveDelay = staggered ? STAGGER_MS * 2 : 0
  return {
    attach: { entering: FadeInRight.duration(DURATION), exiting: FadeOutLeft.duration(DURATION) },
    slot: {
      entering: FadeInRight.duration(DURATION).delay(slotDelay),
      exiting: FadeOutLeft.duration(DURATION).delay(slotDelay),
    },
    trailing: {
      entering: FadeInRight.duration(DURATION).delay(slotDelay),
      exiting: FadeOutLeft.duration(DURATION).delay(slotDelay),
    },
    wave: {
      entering: FadeIn.duration(DURATION).delay(waveDelay),
      exiting: FadeOut.duration(DURATION),
    },
    layout: MOVE,
  }
}

export const composerDictationMotionOf = (
  transition: EDictationTransition,
): IComposerDictationMotion => {
  if (transition === EDictationTransition.SwipeDown) return swipeDownOf()
  return swipeLeftOf({ staggered: transition === EDictationTransition.SwipeLeftStaggered })
}
