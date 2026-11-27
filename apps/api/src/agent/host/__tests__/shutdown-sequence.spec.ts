import { describe, expect, it } from 'bun:test'
import {
  DRAIN_HANDOFF_BUDGET_MS,
  DRAIN_IN_FLIGHT_CAP_MS,
  type HostTimers,
} from '@dltech/atlas-host'
import { LogPort } from '@dltech/atlas-observability'
import type { StreamServerMessage } from '@dltech/atlas-protocol'

import { createSessionStream } from '../../stream/session-stream'
import { STREAM_DRAIN_RECONNECT_SPREAD_MS } from '../../stream/stream-limits'
import type { SubscriptionPort } from '../../stream/subscription-port'
import { createUserSlots } from '../../stream/user-slots'
import { HostShutdownSequence, type HostShutdownSequenceArgs } from '../shutdown-sequence'

class MemoryLog extends LogPort {
  readonly messages: string[] = []
  record(entry: Parameters<LogPort['record']>[0]): void {
    this.messages.push(entry.message)
  }
}

const recorder = (calls: string[]) => {
  const record = (name: string) => async (): Promise<void> => {
    calls.push(name)
  }
  return record
}

const sequenceOf = (
  args: Partial<HostShutdownSequenceArgs> & { stream?: HostShutdownSequenceArgs['stream'] } = {},
  given: string[] = [],
) => {
  const calls = given
  const record = recorder(calls)
  const log = new MemoryLog()
  const sequence = new HostShutdownSequence({
    watch: { close: record('watch.close') },
    presence: { close: record('presence.close') },
    wakes: { close: record('wakes.close') },
    liveFrames: { close: record('liveFrames.close') },
    podMetrics: { close: record('podMetrics.close') },
    podCalls: { close: record('podCalls.close') },
    stream: { drain: () => undefined, stop: record('stream.stop') },
    holder: { drain: record('holder.drain') },
    follow: { close: record('follow.close') },
    pool: { end: record('pool.end') },
    log,
    ...args,
  })
  return { sequence, calls, log }
}

const subscriptions: SubscriptionPort = {
  open: () => ({ handle: () => undefined, drain: () => undefined, close: () => undefined }),
}

const timers: HostTimers = {
  now: () => Date.now(),
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  random: () => 1,
}

const pull = async (
  generator: AsyncGenerator<StreamServerMessage>,
): Promise<StreamServerMessage> => {
  const step = await generator.next()
  if (step.done === true) throw new Error('the stream ended early')
  return step.value
}

const stuck = (): Promise<void> => new Promise<void>(() => {})

describe('HostShutdownSequence', () => {
  it('closes what follows the drains in the order the host has always used', async () => {
    const { sequence, calls } = sequenceOf()

    await sequence.onApplicationShutdown()

    expect(calls).toEqual([
      'watch.close',
      'presence.close',
      'wakes.close',
      'liveFrames.close',
      'podMetrics.close',
      'stream.stop',
      'follow.close',
      'podCalls.close',
      'pool.end',
    ])
  })

  it('stops at the first close that fails so the failure still reaches the drain', async () => {
    const calls: string[] = []
    const { sequence } = sequenceOf(
      {
        watch: {
          close: async () => {
            calls.push('watch.close')
            throw new Error('watch stuck')
          },
        },
      },
      calls,
    )

    await expect(sequence.onApplicationShutdown()).rejects.toThrow('watch stuck')
    expect(calls).toEqual(['watch.close'])
  })

  it('drains the stream and then waits on the holder', async () => {
    const calls: string[] = []
    const { sequence, log } = sequenceOf(
      {
        stream: {
          drain: () => {
            calls.push('stream.drain')
          },
          stop: async () => undefined,
        },
      },
      calls,
    )

    await sequence.beforeApplicationShutdown()

    expect(calls).toEqual(['stream.drain', 'holder.drain'])
    expect(log.messages).toEqual(['draining'])
  })

  it('hands a held session back and lets an open stream go away well inside the cap', async () => {
    const users = createUserSlots({ limit: 4 })
    const stream = createSessionStream({
      users,
      timers,
      eventTypes: undefined,
      log: undefined,
    })
    stream.start({ subscriptions })
    const open = stream.follow({ userId: 'user-1', sessionId: 'session-1' })
    const ready = await pull(open)
    expect(ready.type).toBe('ready')

    const { sequence } = sequenceOf({ stream })
    const startedAt = Date.now()
    await sequence.beforeApplicationShutdown()
    const elapsed = Date.now() - startedAt

    expect(elapsed).toBeLessThan(1_000)
    const away = await pull(open)
    expect(away.type).toBe('going-away')
    if (away.type === 'going-away') {
      expect(away.reconnectAfterMs).toBe(STREAM_DRAIN_RECONNECT_SPREAD_MS)
    }
    expect((await open.next()).done).toBe(true)
    expect(DRAIN_HANDOFF_BUDGET_MS).toBeGreaterThan(DRAIN_IN_FLIGHT_CAP_MS)
    expect(DRAIN_HANDOFF_BUDGET_MS).toBeLessThan(300_000)
  })

  it('warns and returns instead of exiting when the hand-off outlives its budget', async () => {
    const { sequence, log } = sequenceOf({
      holder: { drain: stuck },
      handoffBudgetMs: 25,
    })

    const startedAt = Date.now()
    await sequence.beforeApplicationShutdown()

    expect(Date.now() - startedAt).toBeLessThan(1_000)
    expect(log.messages).toEqual([
      'draining',
      "the lease hand-off outlived 25ms; the next host claims these sessions once this host's presence lock is gone",
    ])
  })
})
