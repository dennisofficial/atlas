import { useSyncExternalStore } from 'react'

import type { ThreadId } from '@dltech/atlas-core'

type Failure = { threadId: ThreadId; detail: string }

let held: Failure | null = null
const listeners = new Set<() => void>()

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const emit = (): void => {
  for (const listener of [...listeners]) listener()
}

export const recordAttachFailure = (failure: Failure): void => {
  held = failure
  emit()
}

export const clearAttachFailure = (): void => {
  if (held === null) return
  held = null
  emit()
}

export const useAttachFailure = (): Failure | null => useSyncExternalStore(subscribe, () => held)
