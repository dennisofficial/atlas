import { createSessionContextReader } from '@dltech/atlas-harness'

import type { FrameBuffer } from './frame-buffer'
import type { ServeApp } from './serve-app'
import { subscribeThreadBroadcasts } from './serve-thread-broadcasts'
import type { SessionHandlers } from './socket-session-types'

export function bindServeSubscriptions(args: {
  app: ServeApp
  buffer: FrameBuffer
  handlers: SessionHandlers
  contextReader: ReturnType<typeof createSessionContextReader>
  note: () => void
  captureRunning: () => void
}): () => void {
  const { app, buffer, handlers, contextReader, note, captureRunning } = args
  const unsubscribeContext = contextReader.subscribe(() => {
    handlers.broadcast(buffer.push({ type: 'context-changed' }))
  })
  const unsubscribeThreads = subscribeThreadBroadcasts({ threads: app.threads, broadcast: handlers.broadcast })
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
  const unsubscribePending = app.pending?.subscribe(note)
  return () => {
    unsubscribeRoster?.()
    unsubscribePrStates?.()
    unsubscribeThreads?.()
    unsubscribeContext()
    unsubscribePending?.()
  }
}
