export type ThreadSignalListener = {
  onHead?: (head: number) => void
  onPod?: () => void
  onTitle?: () => void
  onStarted?: () => void
}

export type ThreadSignalHub = {
  listen: (listener: ThreadSignalListener) => () => void
  emitHead: (head: number) => void
  emitPod: () => void
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
    emitPod: () => {
      for (const listener of [...listeners]) listener.onPod?.()
    },
    emitTitle: () => {
      for (const listener of [...listeners]) listener.onTitle?.()
    },
    emitStarted: () => {
      for (const listener of [...listeners]) listener.onStarted?.()
    },
  }
}
