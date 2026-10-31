import type { PodStatus, WireThread } from '@dltech/atlas-wire/web'

import type { EventsBatch, EventsCheckpoint } from './events-snapshot'

export type ThreadMetadata = { thread: WireThread; rev: number }
export type ThreadPodSignal = { status?: PodStatus; rev?: number }
export type ThreadSignalListener = {
  onHead?: (head: number) => void
  onCheckpoint?: (checkpoint: EventsCheckpoint) => void
  onEvents?: (batch: EventsBatch) => void
  onReset?: (checkpoint: EventsCheckpoint) => void
  onPod?: (payload: ThreadPodSignal) => void
  onMeta?: (metadata: ThreadMetadata) => void
  onTitle?: () => void
  onStarted?: () => void
}

export type ThreadSignalHub = ReturnType<typeof createThreadSignalHub>

export function createThreadSignalHub() {
  const listeners = new Set<ThreadSignalListener>()
  let latest: EventsCheckpoint | undefined
  const accept = (args: { checkpoint: EventsCheckpoint; reset?: boolean }): boolean => {
    const { checkpoint } = args
    if (latest?.historyRev !== undefined && checkpoint.historyRev !== undefined) {
      if (checkpoint.historyRev < latest.historyRev) return false
      if (
        !args.reset &&
        checkpoint.historyRev === latest.historyRev &&
        checkpoint.head < latest.head
      )
        return false
    }
    latest = {
      head: checkpoint.head,
      ...(checkpoint.historyRev === undefined ? {} : { historyRev: checkpoint.historyRev }),
    }
    return true
  }
  const emitCheckpoint = (checkpoint: EventsCheckpoint) => {
    if (!accept({ checkpoint })) return
    for (const listener of [...listeners]) {
      listener.onHead?.(checkpoint.head)
      listener.onCheckpoint?.(checkpoint)
    }
  }
  return {
    listen: (listener: ThreadSignalListener) => {
      listeners.add(listener)
      if (latest?.historyRev !== undefined) listener.onCheckpoint?.(latest)
      return () => {
        listeners.delete(listener)
      }
    },
    emitHead: (head: number) => emitCheckpoint({ head }),
    emitCheckpoint,
    emitEvents: (batch: EventsBatch) => {
      if (!accept({ checkpoint: batch })) return
      for (const listener of [...listeners]) {
        listener.onEvents?.(batch)
        listener.onHead?.(batch.head)
      }
    },
    emitReset: (checkpoint: EventsCheckpoint) => {
      if (!accept({ checkpoint, reset: true })) return
      for (const listener of [...listeners]) listener.onReset?.(checkpoint)
    },
    emitPod: (payload: ThreadPodSignal = {}) => {
      for (const listener of [...listeners]) listener.onPod?.(payload)
    },
    emitMeta: (metadata: ThreadMetadata) => {
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
