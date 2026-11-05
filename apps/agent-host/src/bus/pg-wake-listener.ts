import type { LogPort } from '@dltech/atlas-observability'
import { PG_HOST_CHANGE_CHANNEL, PG_WAKE_CHANNEL } from '@dltech/atlas-protocol'

import { startPgListener, type PgListenerClient } from './pg-listener'

export type PgWakeListener = {
  onWake(listener: (sessionId: string) => void): () => void
  onResync(listener: () => void): () => void
  onHostChange(listener: () => void): () => void
  close(): Promise<void>
}

export type PgWakeClient = PgListenerClient

export const startPgWakeListener = (args: {
  url: string
  applicationName?: string | undefined
  createClient?: (() => PgWakeClient) | undefined
  log?: LogPort | undefined
}): PgWakeListener => {
  const hostChangeListeners = new Set<() => void>()
  const listener = startPgListener({
    url: args.url,
    channels: [PG_WAKE_CHANNEL, PG_HOST_CHANGE_CHANNEL],
    applicationName: args.applicationName ?? 'atlas-wake-listener',
    createClient: args.createClient,
    log: args.log,
    source: 'bus.pg-wake',
  })

  const fireHostChange = (): void => {
    for (const hostChange of [...hostChangeListeners]) hostChange()
  }

  listener.on(PG_HOST_CHANGE_CHANNEL, fireHostChange)
  listener.onReconnect(fireHostChange)

  return {
    onWake: (wake) => listener.on(PG_WAKE_CHANNEL, wake),
    onResync: (resync) => listener.onReconnect(resync),

    onHostChange(hostChange) {
      hostChangeListeners.add(hostChange)
      return () => {
        hostChangeListeners.delete(hostChange)
      }
    },

    close: () => listener.close(),
  }
}
