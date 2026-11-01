import type { Event, EventLogPort, ForkEvent, ThreadId } from '@dltech/atlas-core'
import { SessionsClient, type WireEvent } from '@dltech/atlas-harness'

import type { ApiRemote } from './api-client'
import type { ResolveFork } from './serve-event-flush'
import { createForkReconciler, type RedeliverInput } from './serve-fork-reconcile'
import type { ServeLog } from './serve-log'

const bodyOf = (wire: WireEvent): unknown => {
  try {
    return JSON.parse(wire.body)
  } catch {
    return undefined
  }
}

const remoteForkEventOf = (wire: WireEvent): ForkEvent => ({
  seq: wire.seq,
  type: wire.type,
  body: bodyOf(wire),
})

const localForkEventOf = (event: Event): ForkEvent => ({
  seq: event.seq,
  type: event.type,
  body: event,
})

export function resolveForkFor(args: {
  threadId: ThreadId
  remote: ApiRemote
  events: Pick<EventLogPort, 'readOwn'>
  canRedeliverNow: () => boolean
  redeliver: RedeliverInput
  log: ServeLog
}): ResolveFork {
  const { threadId } = args
  const sessions = new SessionsClient({
    url: args.remote.controlPlaneUrl,
    token: args.remote.token,
    clientVersion: args.remote.clientVersion,
    fetchFn: args.remote.fetchFn,
  })
  const reconciler = createForkReconciler({
    threadId,
    readRemoteTail: async ({ fromSeq }) =>
      (await sessions.readEvents({ threadId, fromSeq, own: true }))
        .sort((a, b) => a.seq - b.seq)
        .map(remoteForkEventOf),
    readLocal: async () => (await args.events.readOwn({ threadId })).map(localForkEventOf),
    canRedeliverNow: args.canRedeliverNow,
    redeliver: args.redeliver,
    log: args.log,
  })
  return (given) => reconciler.reconcile(given)
}
