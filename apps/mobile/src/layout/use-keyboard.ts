import { useSyncExternalStore } from 'react'
import {
  Dimensions,
  Keyboard,
  type KeyboardEvent,
  type KeyboardEventEasing,
  Platform,
} from 'react-native'

import { keyboardInsetOf } from './keyboard-inset'

export type TKeyboard = {
  duration: number
  easing: KeyboardEventEasing
  inset: number
}

const QUIET: TKeyboard = { duration: 0, easing: 'keyboard', inset: 0 }
const listeners = new Set<() => void>()
let state: TKeyboard = QUIET

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const snapshotOf = (): TKeyboard => state

const handleChange = (event: KeyboardEvent): void => {
  const inset = keyboardInsetOf({
    frame: event.endCoordinates,
    platform: Platform.OS,
    windowHeight: Dimensions.get('window').height,
  })
  if (inset === state.inset && event.duration === state.duration && event.easing === state.easing) {
    return
  }
  state = { duration: event.duration, easing: event.easing, inset }
  for (const listener of listeners) listener()
}

for (const name of ['keyboardWillChangeFrame', 'keyboardDidShow', 'keyboardDidHide'] as const) {
  Keyboard.addListener(name, handleChange)
}

export const useKeyboard = (): TKeyboard => useSyncExternalStore(subscribe, snapshotOf, snapshotOf)
