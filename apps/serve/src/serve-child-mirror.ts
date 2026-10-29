import type { EventLogPort, ThreadId } from '@dltech/atlas-core'
import type { DeltaChannel } from '@dltech/atlas-harness'

import { type ApiRemote, createApiClient } from './api-client'
import {
  ControlPlaneRefusal,
  createEventFlusher,
  failedWith,
  httpPostPodEvents,
  httpTruncatePodEvents,
  type EventFlusher,
} from './serve-event-flush'
import { EServeEvent, type ServeLog } from './serve-log'

export type ChildIdentity = { threadId: ThreadId; spawnedBy: ThreadId; agentType: string }

export type ChildMirror = Pick<EventFlusher, 'flush' | 'rebase'> & { detach: () => void }

export type RegisterChild = (child: ChildIdentity) => Promise<number>

export function httpRegisterChild(remote: ApiRemote): RegisterChild {
  const client = createApiClient(remote)
  return async (child) => {
    try {
      return (await client.sandboxSelf.registerChild.mutate(child)).head
    } catch (failure) {
      throw failedWith(failure)
    }
  }
}

export const isSettledSignal = (signal: { type: string; working?: boolean }): boolean =>
  signal.type === 'step-ended' ||
  signal.type === 'events-appended' ||
  (signal.type === 'turn-working' && !signal.working)

export function createChildMirror(args: {
  child: ChildIdentity
  events: Pick<EventLogPort, 'readOwn'>
  channel: Pick<DeltaChannel, 'subscribe'>
  register: RegisterChild
  remote: ApiRemote
  refusalSettles: boolean
  log: ServeLog
}): ChildMirror {
  const { child, log } = args
  let flusher: EventFlusher | undefined
  let chain: Promise<unknown> = Promise.resolve()

  const ensureFlusher = async (): Promise<EventFlusher | undefined> => {
    if (flusher !== undefined) return flusher
    try {
      const head = await args.register(child)
      flusher = createEventFlusher({
        threadId: child.threadId,
        events: args.events,
        durableHead: head,
        post: httpPostPodEvents(args.remote, child.threadId),
        truncate: httpTruncatePodEvents(args.remote, child.threadId),
        refusalSettles: args.refusalSettles,
        log,
      })
      return flusher
    } catch (failure) {
      const reason = failure instanceof Error ? failure.message : String(failure)
      const refused = args.refusalSettles && failure instanceof ControlPlaneRefusal
      log({
        event: refused ? EServeEvent.EventFlushRefused : EServeEvent.EventFlushFailed,
        threadId: child.threadId,
        reason,
      })
      return undefined
    }
  }

  const run = (work: (ready: EventFlusher) => Promise<boolean>, unregistered: boolean) => {
    const next = chain.then(async () => {
      const ready = await ensureFlusher()
      return ready === undefined ? unregistered : work(ready)
    })
    chain = next.catch(() => undefined)
    return next
  }

  const flush = () => run((ready) => ready.flush(), args.refusalSettles)
  const unsubscribe = args.channel.subscribe({
    threadId: child.threadId,
    listener: (signal) => {
      if (isSettledSignal(signal)) void flush()
    },
  })
  return {
    flush,
    rebase: (given) => run((ready) => ready.rebase(given), args.refusalSettles),
    detach: unsubscribe,
  }
}
