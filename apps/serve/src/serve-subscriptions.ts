import type { ThreadId } from '@dltech/atlas-core'
import { createSessionContextReader } from '@dltech/atlas-harness'

import { subscriptionsSnapshot } from './serve-subscription-requests'
import { terminalFrameOf } from './terminal-frames'
import type { FrameBuffer } from './frame-buffer'
import type { ServeApp } from './serve-app'
import { subscribeThreadBroadcasts } from './serve-thread-broadcasts'
import type { SessionHandlers } from './socket-session-types'

export function bindServeSubscriptions(args: {
  app: ServeApp
  threadId: ThreadId
  buffer: FrameBuffer
  handlers: SessionHandlers
  contextReader: ReturnType<typeof createSessionContextReader>
  note: () => void
  captureRunning: () => void
}): () => void {
  const { app, threadId, buffer, handlers, contextReader, note, captureRunning } = args
  const unsubscribeContext = contextReader.subscribe(() => {
    handlers.broadcast(buffer.push({ type: 'context-changed' }))
  })
  const unsubscribeThreads = subscribeThreadBroadcasts({
    threads: app.threads,
    titling: app.titling,
    threadId,
    broadcast: (frame: Parameters<SessionHandlers['broadcast']>[0]) => handlers.broadcast(frame),
  })
  const unsubscribeRoster = app.roster?.subscribe(() => {
    note()
    captureRunning()
    handlers.broadcastRoster()
  })
  let lastPrStatesJson = ''
  const unsubscribePrStates = app.prStates?.subscribe(() => {
    note()
    const next = JSON.stringify(app.prStates?.snapshot() ?? [])
    if (next === lastPrStatesJson) return
    lastPrStatesJson = next
    handlers.broadcastPrStates()
  })
  let lastSubscriptionsJson = ''
  const unsubscribeSubscriptions = app.subscriptions?.registry.onChange(() => {
    note()
    const next = JSON.stringify(
      app.subscriptions === undefined ? [] : subscriptionsSnapshot(app.subscriptions),
    )
    if (next === lastSubscriptionsJson) return
    lastSubscriptionsJson = next
    handlers.broadcastSubscriptions()
  })
  const unsubscribePending = app.pending?.subscribe(note)
  const unsubscribeTerminal = app.terminal?.subscribe((event) => {
    note()
    handlers.broadcast(terminalFrameOf(event))
  })
  return () => {
    unsubscribeRoster?.()
    unsubscribePrStates?.()
    unsubscribeSubscriptions?.()
    unsubscribeThreads?.()
    unsubscribeContext()
    unsubscribePending?.()
    unsubscribeTerminal?.()
  }
}
