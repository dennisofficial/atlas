import type { InMemoryControlStore } from '@dltech/atlas-control/testing'

import type { HostPresence } from '../holder/ports'

export type MemoryHostPresence = HostPresence & { lose(): void }

export const createMemoryHostPresence = (args: {
  store: InMemoryControlStore
}): MemoryHostPresence => {
  const live = new Set<number>()
  const listeners = new Set<(hostId: number) => void>()

  const loseOne = (hostId: number): void => {
    if (!live.delete(hostId)) return
    args.store.markHostAbsent(hostId)
    for (const listener of [...listeners]) listener(hostId)
  }

  return {
    async register() {
      const hostId = args.store.nextHostId()
      args.store.markHostPresent(hostId)
      live.add(hostId)
      return hostId
    },

    onLost(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    async close() {
      for (const hostId of live) args.store.markHostAbsent(hostId)
      live.clear()
    },

    async abandon(hostId) {
      loseOne(hostId)
    },

    lose() {
      for (const hostId of [...live]) loseOne(hostId)
    },
  }
}
