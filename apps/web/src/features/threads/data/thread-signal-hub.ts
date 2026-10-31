import type { PodStatus, WireThread } from '@dltech/atlas-wire/web'

export type ThreadMetadata = { thread: WireThread; rev: number }
export type ThreadPodSignal = { status?: PodStatus; rev?: number }

export type ThreadSignalListener = {
  onHead?: (head: number) => void
  onPod?: (payload: ThreadPodSignal) => void
  onMeta?: (metadata: ThreadMetadata) => void
  onTitle?: () => void
  onStarted?: () => void
}

export type ThreadSignalHub = {
  listen: (listener: ThreadSignalListener) => () => void
  emitHead: (head: number) => void
  emitPod: (payload?: ThreadPodSignal) => void
  emitMeta: (metadata: ThreadMetadata) => void
  emitTitle: () => void
  emitStarted: () => void
}

export function createThreadSignalHub(): ThreadSignalHub {
  const listeners = new Set<ThreadSignalListener>()
  return {
    listen: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emitHead: (head) => {
      for (const listener of [...listeners]) listener.onHead?.(head)
    },
    emitPod: (payload = {}) => {
      for (const listener of [...listeners]) listener.onPod?.(payload)
    },
    emitMeta: (metadata) => {
      for (const listener of [...listeners]) listener.onMeta?.(metadata)
    },
    emitTitle: () => {
      for (const listener of [...listeners]) listener.onTitle?.()
    },
    emitStarted: () => {
      for (const listener of [...listeners]) listener.onStarted?.()
    },
  }
}
