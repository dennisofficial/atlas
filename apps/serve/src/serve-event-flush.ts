import type { Event, EventLogPort, ThreadId } from '@dltech/atlas-core'
import { wireDraftOf } from '@dltech/atlas-harness'
import {
  MAX_POD_EVENTS_PER_FLUSH,
  podEventsReplySchema,
  SANDBOX_SELF_EVENTS_PATH,
  SANDBOX_SELF_EVENTS_TRUNCATE_PATH,
  type PodEvent,
} from '@dltech/atlas-wire'

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

const REFUSAL_STATUSES: readonly number[] = [401, 403]

const failedWith = (response: Response): Error =>
  REFUSAL_STATUSES.includes(response.status)
    ? new ControlPlaneRefusal({ status: response.status })
    : new Error(`the control plane answered ${response.status}`)

export type PostPodEvents = (events: readonly PodEvent[]) => Promise<FlushReply>

export type TruncatePodEvents = (toSeq: number) => Promise<number>

export type EventFlusher = {
  flush: () => Promise<boolean>
  rebase: (args: { toSeq: number }) => Promise<boolean>
  durableHead: () => number
}

export function podEventOf(event: Event): PodEvent {
  const { id: _id, seq, threadId: _thread, runId, parentRunId, depth, at, ...draft } = event
  const wire = wireDraftOf(draft)
  return {
    seq,
    runId,
    depth,
    at,
    type: wire.type,
    body: wire.body,
    ...(parentRunId === undefined ? {} : { parentRunId }),
    ...(wire.contextSlot === undefined ? {} : { contextSlot: wire.contextSlot }),
    ...(wire.contextKey === undefined ? {} : { contextKey: wire.contextKey }),
    ...(wire.contextDigest === undefined ? {} : { contextDigest: wire.contextDigest }),
  }
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

type PodRemote = {
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
}

const postTo = (args: { remote: PodRemote; path: string; body: unknown }): Promise<Response> =>
  args.remote.fetchFn(`${args.remote.controlPlaneUrl.replace(/\/+$/, '')}${args.path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${args.remote.token}`,
      'content-type': 'application/json',
      'atlas-client-version': args.remote.clientVersion,
    },
    body: JSON.stringify(args.body),
  })

export function httpTruncatePodEvents(remote: PodRemote): TruncatePodEvents {
  return async (toSeq) => {
    const response = await postTo({
      remote,
      path: SANDBOX_SELF_EVENTS_TRUNCATE_PATH,
      body: { toSeq },
    })
    if (!response.ok) throw failedWith(response)
    return podEventsReplySchema.parse(await response.json()).head
  }
}

export function httpPostPodEvents(remote: PodRemote): PostPodEvents {
  return async (events) => {
    const response = await postTo({ remote, path: SANDBOX_SELF_EVENTS_PATH, body: { events } })
    if (response.status === 409) {
      const body: unknown = await response.json().catch(() => ({}))
      const seq =
        typeof body === 'object' && body !== null && 'seq' in body && typeof body.seq === 'number'
          ? body.seq
          : undefined
      return { kind: EFlushReply.Conflict, seq }
    }
    if (!response.ok) throw failedWith(response)
    return {
      kind: EFlushReply.Stored,
      head: podEventsReplySchema.parse(await response.json()).head,
    }
  }
}
