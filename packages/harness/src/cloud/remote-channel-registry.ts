import type { Unsubscribe } from '../channel/delta-channel'

export type Registry<T> = {
  add(listener: (value: T) => void): Unsubscribe
  emit(value: T): void
}

export const registryOf = <T>(): Registry<T> => {
  const listeners = new Set<(value: T) => void>()
  return {
    add(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit(value) {
      for (const listener of [...listeners]) listener(value)
    },
  }
}
