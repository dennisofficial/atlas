import type { EventLogPort, ThreadId } from '@dltech/atlas-core'
import { podEventOf } from '@dltech/atlas-harness'
import { MAX_POD_EVENTS_PER_FLUSH, type PodEvent } from '@dltech/atlas-wire'

import { type ApiRemote, createApiClient, detailsOf, httpStatusOf } from './api-client'
import { EServeEvent, type ServeLog } from './serve-log'

export enum EFlushReply {
  Stored = 'stored',
  Conflict = 'conflict',
}

export type FlushReply =
  | { kind: EFlushReply.Stored; head: number }
  | { kind: EFlushReply.Conflict; seq: number | undefined }

export class ControlPlaneRefusal extends Error {
  readonly status: number

  constructor(args: { status: number }) {
    super(`the control plane answered ${args.status}`)
    this.name = 'ControlPlaneRefusal'
    this.status = args.status
  }
}

const REFUSAL_STATUSES: readonly number[] = [401, 403, 404]

export const failedWith = (failure: unknown): Error => {
  const status = httpStatusOf(failure)
  if (status === undefined) return failure instanceof Error ? failure : new Error(String(failure))
  return REFUSAL_STATUSES.includes(status)
    ? new ControlPlaneRefusal({ status })
    : new Error(`the control plane answered ${status}`)
}

export type PostPodEvents = (events: readonly PodEvent[]) => Promise<FlushReply>

export type TruncatePodEvents = (toSeq: number) => Promise<number>

export type EventFlusher = {
  flush: () => Promise<boolean>
  rebase: (args: { toSeq: number }) => Promise<boolean>
  durableHead: () => number
}

const reasonOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export function createEventFlusher(args: {
  threadId: ThreadId
  events: Pick<EventLogPort, 'readOwn'>
  durableHead: number
  post: PostPodEvents
  truncate: TruncatePodEvents
  log: ServeLog
  refusalSettles?: boolean | undefined
}): EventFlusher {
  const { threadId, log } = args
  let durable = args.durableHead
  let chain: Promise<boolean> = Promise.resolve(true)
  let queued: Promise<boolean> | undefined

  const shipBatch = async (batch: readonly PodEvent[]): Promise<boolean> => {
    const reply = await args.post(batch)
    if (reply.kind === EFlushReply.Conflict) {
      log({ event: EServeEvent.EventFlushConflict, threadId, seq: reply.seq, durableHead: durable })
      return false
    }
    durable = Math.max(durable, reply.head)
    return true
  }

  const once = async (): Promise<boolean> => {
    try {
      const pending = await args.events.readOwn({ threadId, fromSeq: durable })
      const events = pending.map(podEventOf)
      for (let start = 0; start < events.length; start += MAX_POD_EVENTS_PER_FLUSH) {
        const shipped = await shipBatch(events.slice(start, start + MAX_POD_EVENTS_PER_FLUSH))
        if (!shipped) return false
      }
      if (events.length > 0) log({ event: EServeEvent.EventsFlushed, threadId, head: durable })
      return true
    } catch (failure) {
      if (args.refusalSettles === true && failure instanceof ControlPlaneRefusal) {
        log({ event: EServeEvent.EventFlushRefused, threadId, reason: reasonOf(failure) })
        return true
      }
      log({ event: EServeEvent.EventFlushFailed, threadId, reason: reasonOf(failure) })
      return false
    }
  }

  const flush = (): Promise<boolean> => {
    if (queued !== undefined) return queued
    const next = chain.then(() => {
      queued = undefined
      return once()
    })
    queued = next
    chain = next
    return next
  }

  const truncateTo = async (toSeq: number): Promise<boolean> => {
    if (toSeq >= durable) return true
    try {
      durable = await args.truncate(toSeq)
      log({ event: EServeEvent.EventsTruncated, threadId, head: durable })
      return true
    } catch (failure) {
      log({ event: EServeEvent.EventFlushFailed, threadId, reason: reasonOf(failure) })
      return false
    }
  }

  const rebase = (given: { toSeq: number }): Promise<boolean> => {
    queued = undefined
    const next = chain.then(async () => (await truncateTo(given.toSeq)) && once())
    chain = next
    return next
  }

  return { flush, rebase, durableHead: () => durable }
}

export function httpTruncatePodEvents(
  remote: ApiRemote,
  threadId?: ThreadId | undefined,
): TruncatePodEvents {
  const client = createApiClient(remote)
  return async (toSeq) => {
    try {
      const target = threadId === undefined ? {} : { threadId }
      return (await client.sandboxSelf.truncateEvents.mutate({ ...target, toSeq })).head
    } catch (failure) {
      throw failedWith(failure)
    }
  }
}

export function httpPostPodEvents(
  remote: ApiRemote,
  threadId?: ThreadId | undefined,
): PostPodEvents {
  const client = createApiClient(remote)
  return async (events) => {
    try {
      const target = threadId === undefined ? {} : { threadId }
      const reply = await client.sandboxSelf.events.mutate({ ...target, events: [...events] })
      return { kind: EFlushReply.Stored, head: reply.head }
    } catch (failure) {
      if (httpStatusOf(failure) !== 409) throw failedWith(failure)
      const seq = detailsOf(failure)?.seq
      return { kind: EFlushReply.Conflict, seq: typeof seq === 'number' ? seq : undefined }
    }
  }
}
