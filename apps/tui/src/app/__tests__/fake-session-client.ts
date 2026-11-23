import type { V2Event } from '@dltech/atlas-core'
import type { StreamSessionRow } from '@dltech/atlas-protocol'
import { createStreamConnection, type StreamConnection } from '@dltech/atlas-client/stream'
import {
  createFakeScheduler,
  createFakeTransport,
  eventsMessage,
} from '@dltech/atlas-client/stream-fixture'

import { v2EventSchema, v2EventTypes, v2Views } from '../registered-plugins'
import type { AuthRefusal, SessionClient } from '../session-client'

export type FakeSessionClient = SessionClient & {
  pushRows: (rows: readonly StreamSessionRow[]) => void
  pushEvents: (args: { sessionId: string; events: readonly V2Event[]; live: boolean }) => void
  refuse: (status: AuthRefusal) => void
}

const NO_NETWORK_SIGNAL = () => () => undefined

export const fakeSessionClient = (args: {
  onAuthLost: (status: AuthRefusal) => void
}): FakeSessionClient => {
  const fake = createFakeTransport()
  const scheduler = createFakeScheduler()
  const connection: StreamConnection = createStreamConnection({
    transport: fake.transport,
    scheduler: scheduler.scheduler,
    networkSignal: NO_NETWORK_SIGNAL,
    eventSchema: v2EventSchema,
    knownEventTypes: v2EventTypes,
    views: v2Views,
  })

  let frames = 0
  const nextId = (): string => {
    frames += 1
    return `frame-${frames}`
  }

  return {
    apiUrl: 'https://api.example.test',
    connection,
    close: () => connection.close(),
    pushRows: (rows) => {
      for (const subscription of fake.lists) {
        if (subscription.closed) continue
        subscription.handlers.handleFrame({
          type: 'snapshot',
          id: nextId(),
          rows: rows.map((row) => ({ ...row })),
        })
      }
    },
    pushEvents: (input) => {
      for (const subscription of fake.follows) {
        if (subscription.closed) continue
        if (subscription.input?.sessionId !== input.sessionId) continue
        subscription.handlers.handleFrame(
          eventsMessage({ id: input.sessionId, events: input.events, live: input.live }),
        )
      }
    },
    refuse: (status) => {
      args.onAuthLost(status)
      for (const subscription of [...fake.lists, ...fake.follows]) {
        subscription.handlers.handleFailure(status)
      }
    },
  }
}
