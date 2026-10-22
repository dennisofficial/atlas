import type { Event, EventLogPort, ThreadId } from '@dltech/atlas-core'
import { wireDraftOf } from '@dltech/atlas-harness'
import {
  MAX_POD_EVENTS_PER_FLUSH,
  podEventsReplySchema,
  SANDBOX_SELF_EVENTS_PATH,
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

export type PostPodEvents = (events: readonly PodEvent[]) => Promise<FlushReply>

export type EventFlusher = {
  flush: () => Promise<boolean>
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
  log: ServeLog
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

  return { flush, durableHead: () => durable }
}

export function httpPostPodEvents(args: {
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
}): PostPodEvents {
  const url = `${args.controlPlaneUrl.replace(/\/+$/, '')}${SANDBOX_SELF_EVENTS_PATH}`
  return async (events) => {
    const response = await args.fetchFn(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${args.token}`,
        'content-type': 'application/json',
        'atlas-client-version': args.clientVersion,
      },
      body: JSON.stringify({ events }),
    })
    if (response.status === 409) {
      const body: unknown = await response.json().catch(() => ({}))
      const seq =
        typeof body === 'object' && body !== null && 'seq' in body && typeof body.seq === 'number'
          ? body.seq
          : undefined
      return { kind: EFlushReply.Conflict, seq }
    }
    if (!response.ok) throw new Error(`the control plane answered ${response.status}`)
    return {
      kind: EFlushReply.Stored,
      head: podEventsReplySchema.parse(await response.json()).head,
    }
  }
}
