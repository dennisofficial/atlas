import type { ChangeFeed } from '@dltech/atlas-control'
import type { LogPort } from '@dltech/atlas-observability'
import { PG_CHANGE_CHANNEL, sessionChangeSchema, type SessionChange } from '@dltech/atlas-protocol'

import { startPgListener, type PgListenerClient } from './pg-listener'

export type PgChangeFeed = ChangeFeed & { close(): Promise<void> }

export const startPgChangeFeed = (args: {
  url: string
  applicationName?: string | undefined
  createClient?: (() => PgListenerClient) | undefined
  log?: LogPort | undefined
}): PgChangeFeed => {
  const changeListeners = new Set<(change: SessionChange) => void>()
  const gapListeners = new Set<() => void>()
  const listener = startPgListener({
    url: args.url,
    channels: [PG_CHANGE_CHANNEL],
    applicationName: args.applicationName ?? 'atlas-change-feed',
    createClient: args.createClient,
    log: args.log,
    source: 'bus.pg-change-feed',
  })

  listener.on(PG_CHANGE_CHANNEL, (payload) => {
    const change = parseChange(payload)
    if (change === undefined) {
      args.log?.warn({ source: 'bus.pg-change-feed', message: 'dropped malformed change payload' })
      return
    }
    for (const changeListener of [...changeListeners]) changeListener(change)
  })
  listener.onReconnect(() => {
    for (const gapListener of [...gapListeners]) gapListener()
  })

  return {
    onChange(changeListener) {
      changeListeners.add(changeListener)
      return () => {
        changeListeners.delete(changeListener)
      }
    },

    onGap(gapListener) {
      gapListeners.add(gapListener)
      return () => {
        gapListeners.delete(gapListener)
      }
    },

    close: () => listener.close(),
  }
}

const parseChange = (payload: string): SessionChange | undefined => {
  try {
    const parsed = sessionChangeSchema.safeParse(JSON.parse(payload))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}
