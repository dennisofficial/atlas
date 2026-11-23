import { describe, expect, it, spyOn, vi } from 'bun:test'
import { Logger, ServiceUnavailableException } from '@nestjs/common'
import type { EventFrame, PodCallOutcome } from '@dltech/atlas-host'
import {
  ECallStatus,
  ELiveOpFailure,
  type PodMetricsFrame,
  type PodMetricsWatch,
  type PodSample,
} from '@dltech/atlas-protocol'

import { PodMetricsRelay, type PodMetricsBus } from '../../../agent'
import type { PodOps } from '../../../agent'
import { PodMetricsService } from './pod-metrics.service'
import type { SessionsService } from './sessions.service'

const sample = (at: number): PodSample => ({
  at,
  cpuPercent: 12.5,
  ramBytes: 1024,
  ramLimitBytes: 2048,
  throttled: false,
  oomKills: 0,
})

const frameOf = (payload: PodSample): EventFrame => ({
  kind: 'event',
  event: { type: 'metrics.sample', sample: payload },
})

const outcomeOf = (value: PodSample[] | null): PodCallOutcome =>
  value === null
    ? { state: 'unavailable', reason: ELiveOpFailure.Asleep }
    : {
        state: 'ok',
        result: { status: ECallStatus.Ok, op: 'metrics.subscribe', value: { samples: value } },
      }

type FakeBus = PodMetricsBus & {
  frames: { sessionId: string; frame: PodMetricsFrame }[]
  requests: PodMetricsWatch[]
  watchersFor(sessionId: string): number
}

const fakeBusOf = (): FakeBus => {
  const watchListeners = new Set<(request: PodMetricsWatch) => void>()
  const frameListeners = new Map<string, Set<(frame: PodMetricsFrame) => void>>()
  const frames: { sessionId: string; frame: PodMetricsFrame }[] = []
  const requests: PodMetricsWatch[] = []
  return {
    frames,
    requests,
    watchersFor: (sessionId) => frameListeners.get(sessionId)?.size ?? 0,
    async requestWatch(request) {
      requests.push(request)
      for (const listener of [...watchListeners]) listener(request)
    },
    onWatch(listener) {
      watchListeners.add(listener)
      return () => {
        watchListeners.delete(listener)
      }
    },
    async publish(args) {
      frames.push(args)
      for (const listener of [...(frameListeners.get(args.sessionId) ?? [])]) listener(args.frame)
    },
    async subscribe({ sessionId, listener }) {
      const listeners = frameListeners.get(sessionId) ?? new Set<(frame: PodMetricsFrame) => void>()
      listeners.add(listener)
      frameListeners.set(sessionId, listeners)
      return async () => {
        listeners.delete(listener)
      }
    },
    async close() {
      return undefined
    },
  }
}

const sessionsOf = () => ({
  requireOwnedSession: vi.fn(async () => ({})),
})

const operationsOf = (args: { held: boolean; backlog?: PodSample[] | null }) => {
  const state: {
    listener: ((frame: EventFrame) => void) | undefined
    dispose: ReturnType<typeof vi.fn>
  } = { listener: undefined, dispose: vi.fn() }
  const invoke = vi.fn(async (input: { op: { op: string } }) => {
    if (input.op.op === 'metrics.unsubscribe')
      return {
        state: 'ok',
        result: { status: ECallStatus.Ok, op: 'metrics.unsubscribe', value: null },
      }
    return outcomeOf(args.backlog === undefined ? [] : args.backlog)
  })
  const hold = vi.fn((_input: { sessionId: string; ttlMs?: number }) => true)
  const waitForHolder = vi.fn(async (_input: { sessionId: string }) => args.held)
  const events = vi.fn((input: { listener: (frame: EventFrame) => void }) => {
    if (!args.held) return null
    state.listener = input.listener
    return state.dispose
  })
  const ops = { events, hold, invoke, waitForHolder } as unknown as PodOps
  return { ops, hold, waitForHolder, invoke, events, state }
}

const collect = (generator: AsyncGenerator<PodMetricsFrame>) => {
  const frames: PodMetricsFrame[] = []
  const done = (async () => {
    for await (const frame of generator) frames.push(frame)
  })()
  return { frames, done }
}

const until = async (check: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (check()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('timed out')
}

const watch = (service: PodMetricsService, signal?: AbortSignal) =>
  service.watch({
    userId: 'u1',
    sessionId: 's1',
    ...(signal === undefined ? {} : { signal }),
  })

const serviceOf = (args: {
  sessions: ReturnType<typeof sessionsOf>
  bus: PodMetricsBus | null
  renewEveryMs?: number
}) =>
  new PodMetricsService(args.sessions as unknown as SessionsService, args.bus, args.renewEveryMs)

describe('PodMetricsService', () => {
  it('refuses a session the operator does not own', async () => {
    const sessions = sessionsOf()
    sessions.requireOwnedSession.mockImplementationOnce(async () => {
      throw new Error('not yours')
    })
    const bus = fakeBusOf()
    await expect(collect(watch(serviceOf({ sessions, bus }))).done).rejects.toThrow('not yours')
    expect(bus.requests).toEqual([])
  })

  it('refuses the stream when the relay transport is not mounted', async () => {
    const sessions = sessionsOf()
    await expect(collect(watch(serviceOf({ sessions, bus: null }))).done).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
  })

  it('asks for a watch immediately and again on every renewal', async () => {
    const bus = fakeBusOf()
    const abort = new AbortController()
    const run = collect(
      watch(serviceOf({ sessions: sessionsOf(), bus, renewEveryMs: 2 }), abort.signal),
    )
    await until(() => bus.requests.length === 1)
    await until(() => bus.requests.length >= 3)
    abort.abort()
    await run.done
    expect(bus.requests[0]?.sessionId).toBe('s1')
    expect(bus.requests[0]?.ttlMs).toBeGreaterThan(0)
    expect(new Set(bus.requests.map((request) => request.watcherId)).size).toBe(1)
  })

  it('stops renewing and releases its subscription when the client goes away', async () => {
    const bus = fakeBusOf()
    const abort = new AbortController()
    const run = collect(
      watch(serviceOf({ sessions: sessionsOf(), bus, renewEveryMs: 2 }), abort.signal),
    )
    await until(() => bus.requests.length >= 2)
    abort.abort()
    await run.done
    const asked = bus.requests.length
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    expect(bus.requests.length).toBe(asked)
    expect(bus.watchersFor('s1')).toBe(0)
  })

  it('relays the backlog and every live sample from the instance that holds the pod', async () => {
    const bus = fakeBusOf()
    const { ops, state } = operationsOf({ held: true, backlog: [sample(1_000)] })
    const relay = new PodMetricsRelay({ ops, bus })
    relay.onModuleInit()
    const stopping = new AbortController()
    const run = collect(watch(serviceOf({ sessions: sessionsOf(), bus }), stopping.signal))
    await until(() => run.frames.length === 1)
    expect(run.frames).toEqual([{ type: 'samples', samples: [sample(1_000)] }])
    state.listener?.(frameOf(sample(2_000)))
    await until(() => run.frames.length === 2)
    state.listener?.(frameOf(sample(2_000)))
    state.listener?.(frameOf(sample(1_500)))
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
    expect(run.frames).toEqual([
      { type: 'samples', samples: [sample(1_000)] },
      { type: 'sample', sample: sample(2_000) },
    ])
    stopping.abort()
    await run.done
    await relay.onModuleDestroy()
  })

  it('appends a later watcher ring instead of replacing the series', async () => {
    const bus = fakeBusOf()
    const { ops, state } = operationsOf({ held: true, backlog: [sample(1_000)] })
    const relay = new PodMetricsRelay({ ops, bus })
    relay.onModuleInit()
    const stopping = new AbortController()
    const first = collect(watch(serviceOf({ sessions: sessionsOf(), bus }), stopping.signal))
    await until(() => first.frames.length === 1)
    state.listener?.(frameOf(sample(2_000)))
    await until(() => first.frames.length === 2)
    const second = collect(watch(serviceOf({ sessions: sessionsOf(), bus }), stopping.signal))
    await until(() => second.frames.length === 1)
    expect(second.frames).toEqual([{ type: 'samples', samples: [sample(1_000), sample(2_000)] }])
    expect(first.frames).toEqual([
      { type: 'samples', samples: [sample(1_000)] },
      { type: 'sample', sample: sample(2_000) },
    ])
    await relay.onModuleDestroy()
    stopping.abort()
    await first.done
    await second.done
  })

  it('says usage is unavailable and logs why when the pod cannot read metrics', async () => {
    const bus = fakeBusOf()
    const warn = spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { ops } = operationsOf({ held: true, backlog: null })
    const relay = new PodMetricsRelay({ ops, bus })
    relay.onModuleInit()
    const run = collect(watch(serviceOf({ sessions: sessionsOf(), bus })))
    await run.done
    expect(run.frames).toEqual([{ type: 'unavailable', reason: 'pod metrics are not readable' }])
    expect(warn).toHaveBeenCalledWith({ sessionId: 's1', reason: 'pod metrics are not readable' })
    expect(bus.watchersFor('s1')).toBe(0)
    await relay.onModuleDestroy()
    warn.mockRestore()
  })

  it('keeps streaming when no instance of the fleet holds the pod yet', async () => {
    const bus = fakeBusOf()
    const { ops } = operationsOf({ held: false })
    const relay = new PodMetricsRelay({ ops, bus })
    relay.onModuleInit()
    const stopping = new AbortController()
    const run = collect(
      watch(serviceOf({ sessions: sessionsOf(), bus, renewEveryMs: 2 }), stopping.signal),
    )
    await until(() => bus.requests.length >= 3)
    expect(run.frames).toEqual([])
    stopping.abort()
    await run.done
    await relay.onModuleDestroy()
  })
})
