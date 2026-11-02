import { toThreadId, type ThreadId } from '@dltech/atlas-core'

import type { ChannelSignal } from './signal'
import type { Unsubscribe } from './delta-channel-types'

export type ScopedSignal = {
  threadId: ThreadId
  signal: ChannelSignal
}

type TaggedSignal = ChannelSignal & { threadId?: string | undefined }

export const isScopedSignal = (signal: ChannelSignal): signal is TaggedSignal =>
  signal.type === 'turn-working' ||
  signal.type === 'events-appended' ||
  signal.type === 'pending-changed' ||
  signal.type === 'operator-input'

export function createScopedSignalHub(args: { root: () => ThreadId }) {
  const listeners = new Set<(scoped: ScopedSignal) => void>()

  const deliver = (signal: ChannelSignal): void => {
    if (!isScopedSignal(signal)) return
    const scoped: ScopedSignal = {
      threadId: signal.threadId === undefined ? args.root() : toThreadId(signal.threadId),
      signal,
    }
    for (const listener of [...listeners]) listener(scoped)
  }

  const subscribe = (listener: (scoped: ScopedSignal) => void): Unsubscribe => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return { deliver, subscribe }
}

export type ScopedSignalHub = ReturnType<typeof createScopedSignalHub>
