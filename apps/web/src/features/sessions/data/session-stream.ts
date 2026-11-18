import { sessionStreamTransport } from '@dltech/atlas-api-router'
import {
  browserSessionLog,
  createStreamConnection,
  systemStreamScheduler,
  type SessionLog,
  type StreamConnection,
} from '@dltech/atlas-client/stream'

import { api } from '@/lib/api-client'
import { sharedQueryClient } from '@/lib/query-client'
import { SESSION_QUERY_KEY } from '@/lib/use-session-query'

import { sessionEventSchema, sessionEventTypes } from '../registered-plugins'

let connection: StreamConnection | undefined
let log: SessionLog | undefined
let persisted = false

const persistStorage = (): void => {
  if (persisted) return
  persisted = true
  const storage = (globalThis as { navigator?: { storage?: { persist?: () => Promise<boolean> } } })
    .navigator?.storage
  void storage?.persist?.().catch(() => undefined)
}

export function sessionLog(): SessionLog {
  if (log === undefined) {
    persistStorage()
    log = browserSessionLog(sessionEventSchema)
  }
  return log
}

const handleSignedOut = (): void => {
  void sharedQueryClient().invalidateQueries({ queryKey: [SESSION_QUERY_KEY] })
}

export function sessionStream(): StreamConnection {
  if (connection !== undefined) return connection
  connection = createStreamConnection({
    transport: sessionStreamTransport({ client: api, handleUnauthorized: handleSignedOut }),
    scheduler: systemStreamScheduler,
    eventSchema: sessionEventSchema,
    knownEventTypes: sessionEventTypes,
  })
  connection.connect()
  return connection
}
