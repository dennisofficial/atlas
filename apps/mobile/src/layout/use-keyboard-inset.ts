import { useSyncExternalStore } from 'react'
import { Dimensions, Keyboard, type KeyboardEvent, Platform } from 'react-native'

import { keyboardInsetOf } from './keyboard-inset'

const listeners = new Set<() => void>()
let inset = 0

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const snapshotOf = (): number => inset

const handleChange = (event: KeyboardEvent): void => {
  Keyboard.scheduleLayoutAnimation(event)
  const next = keyboardInsetOf({
    frame: event.endCoordinates,
    platform: Platform.OS,
    windowHeight: Dimensions.get('window').height,
  })
  if (next === inset) return
  inset = next
  for (const listener of listeners) listener()
}

for (const name of ['keyboardWillChangeFrame', 'keyboardDidShow', 'keyboardDidHide'] as const) {
  Keyboard.addListener(name, handleChange)
}

export const useKeyboardInset = (): number =>
  useSyncExternalStore(subscribe, snapshotOf, snapshotOf)
