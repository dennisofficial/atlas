import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  chainEvents,
  GENESIS_HASH,
  toCallId,
  toRunId,
  toThreadId,
  type LogHead,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'

import { createFollowSubscriptions } from '../../src/agent/stream/follow-port'
import type { FollowPlane } from '../../src/agent/stream/follow-types'
import { createSessionStream, type SessionStream } from '../../src/agent/stream/session-stream'
import { systemHostTimers } from '../../src/agent/stream/system-timers'
import { createUserSlots } from '../../src/agent/stream/user-slots'

export const BENCH_SESSION = 'bench-session'
export const BENCH_THREAD = 'bench-thread'
export const BENCH_USER = 'bench-user'

const AT = '2026-11-20T12:00:00.000Z'
const SEED_CHUNK = 2_000
const USER_SLOTS = 2_000

const WORDS = [
  'stream',
  'catch',
  'cursor',
  'replay',
  'page',
  'event',
  'socket',
  'latency',
  'client',
  'server',
  'head',
  'window',
  'frame',
  'log',
  'hash',
  'lease',
  'session',
  'thread',
  'turn',
  'result',
]

export const filler = (args: { words: number; seed: number }): string => {
  const parts: string[] = []
  for (let index = 0; index < args.words; index += 1) {
    const word = WORDS[(args.seed + index * 7) % WORDS.length] ?? 'stream'
    parts.push(word)
  }
  return parts.join(' ')
}

const bodyAt = (n: number): V2Body => {
  const turn = Math.floor(n / 4)
  const kind = n % 4
  if (kind === 0) return { type: 'user-said', text: filler({ words: 14, seed: n }) }
  if (kind === 1)
    return {
      type: 'assistant-said',
      parts: [{ type: 'text', text: filler({ words: 400, seed: n }) }],
    }
  if (kind === 2)
    return {
      type: 'tool-called',
      callId: toCallId(`call-${n}`),
      name: 'bash',
      input: { command: filler({ words: 30, seed: n }) },
      ordinal: turn,
    }
  return {
    type: 'tool-result',
    callId: toCallId(`call-${n - 1}`),
    name: 'bash',
    output: { stdout: filler({ words: 260, seed: n }) },
    modelText: filler({ words: 260, seed: n + 1 }),
  }
}

export type QueryCounts = {
  readEvents: number
  readTailBase: number
  head: number
  readSessionView: number
  readSession: number
}

export type BenchWorld = {
  sessionId: string
  userId: string
  stream: SessionStream
  counts: QueryCounts
  events: readonly V2Event[]
  resetCounts(): void
  close(): void
}

const delay = async (ms: number): Promise<void> => {
  if (ms <= 0) return
  await Bun.sleep(ms)
}

export const createBenchWorld = async (args: {
  events: number
  queryDelayMs: number
}): Promise<BenchWorld> => {
  const store = new InMemoryControlStore({ clock: () => AT })
  const plane = new ControlPlane({ store, clock: () => AT })
  const counts: QueryCounts = {
    readEvents: 0,
    readTailBase: 0,
    head: 0,
    readSessionView: 0,
    readSession: 0,
  }

  await plane.createSession({
    sessionId: BENCH_SESSION,
    userId: BENCH_USER,
    projectId: 'bench-project',
    mainThreadId: BENCH_THREAD,
  })
  const lease = await plane.grant({ sessionId: BENCH_SESSION, hostId: 1 })
  const threadId = toThreadId(BENCH_THREAD)
  const seeded: V2Event[] = []
  let head: LogHead = { seq: 0, hash: GENESIS_HASH }
  for (let start = 0; start < args.events; start += SEED_CHUNK) {
    const bodies = Array.from({ length: Math.min(SEED_CHUNK, args.events - start) }, (_, offset) =>
      bodyAt(start + offset),
    )
    const events = chainEvents({
      threadId,
      runId: toRunId('bench-run'),
      epoch: lease.epoch,
      at: AT,
      bodies,
      from: head,
    })
    const outcome = await plane.append({ threadId: BENCH_THREAD, epoch: lease.epoch, events })
    if (!outcome.ok) throw new Error('bench seed append refused')
    head = outcome.head
    seeded.push(...events)
  }

  const followPlane: FollowPlane = {
    readSession: async (params) => {
      counts.readSession += 1
      await delay(args.queryDelayMs)
      return plane.readSession(params)
    },
    head: async (params) => {
      counts.head += 1
      await delay(args.queryDelayMs)
      return plane.head(params)
    },
    readEvents: async (params) => {
      counts.readEvents += 1
      await delay(args.queryDelayMs)
      return plane.readEvents(params)
    },
    readSessionView: async (params) => {
      counts.readSessionView += 1
      await delay(args.queryDelayMs)
      return plane.readSessionView(params)
    },
    readTailBase: async (params) => {
      counts.readTailBase += 1
      await delay(args.queryDelayMs)
      return plane.readTailBase(params)
    },
    listSessionDigests: (params) => plane.listSessionDigests(params),
    readThread: (params) => plane.readThread(params),
  }

  const follow = createFollowSubscriptions({
    plane: followPlane,
    timers: systemHostTimers,
    log: undefined,
    feed: {
      onChange: (listener) => store.onChange(listener),
      onGap: () => () => undefined,
    },
  })
  const stream = createSessionStream({
    users: createUserSlots({ limit: USER_SLOTS }),
    timers: systemHostTimers,
    eventTypes: undefined,
    log: undefined,
  })
  stream.start({ subscriptions: follow })

  return {
    sessionId: BENCH_SESSION,
    userId: BENCH_USER,
    stream,
    counts,
    events: seeded,
    resetCounts: () => {
      counts.readEvents = 0
      counts.readTailBase = 0
      counts.head = 0
      counts.readSessionView = 0
      counts.readSession = 0
    },
    close: () => {
      stream.stop()
      follow.close()
    },
  }
}
