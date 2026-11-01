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
import { resolveForkFor } from './serve-fork-ports'
import type { RedeliverInput } from './serve-fork-reconcile'
import { EServeEvent, type ServeLog } from './serve-log'

export type ChildIdentity = {
  threadId: ThreadId
  spawnedBy: ThreadId
  agentType: string
  title?: string | undefined
}

export type ChildMirror = Pick<EventFlusher, 'flush' | 'rebase'> & { detach: () => void }

export type RegisterChild = (child: ChildIdentity) => Promise<number>

export function httpRegisterChild(remote: ApiRemote): RegisterChild {
  const client = createApiClient(remote)
  return async (child) => {
    try {
      const { title, ...identity } = child
      const titled = title === undefined || title === '' ? identity : { ...identity, title }
      return (await client.sandboxSelf.registerChild.mutate(titled)).head
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
  redeliver: RedeliverInput
  log: ServeLog
  bindActivity?: ((threadId: ThreadId) => { detach: () => void }) | undefined
}): ChildMirror {
  const { child, log } = args
  let flusher: EventFlusher | undefined
  let activity: { detach: () => void } | undefined
  let detached = false
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
        resolveFork: resolveForkFor({
          threadId: child.threadId,
          remote: args.remote,
          events: args.events,
          redeliver: args.redeliver,
          log,
        }),
        log,
      })
      if (!detached) activity = args.bindActivity?.(child.threadId)
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
    detach: () => {
      detached = true
      unsubscribe()
      activity?.detach()
    },
  }
}
