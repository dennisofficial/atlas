import { describe, expect, it, vi } from 'bun:test'
import { ServiceUnavailableException } from '@nestjs/common'
import type { EventFrame, PodCallOutcome } from '@dltech/atlas-host'
import {
  ECallStatus,
  ELiveOpFailure,
  type PodMetricsFrame,
  type PodSample,
} from '@dltech/atlas-protocol'
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

const sessionsOf = () => ({
  requireOwnedSession: vi.fn(async () => ({})),
})

const operationsOf = (args: {
  held: boolean
  backlog?: PodSample[] | null
  onCall?: (op: string) => void
  awaitSubscribe?: Promise<void> | undefined
}) => {
  const state: {
    held: boolean
    listener: ((frame: EventFrame) => void) | undefined
    close: (() => void) | undefined
    dispose: ReturnType<typeof vi.fn>
  } = { held: args.held, listener: undefined, close: undefined, dispose: vi.fn() }
  const invoke = vi.fn(async (input: { op: { op: string } }) => {
    args.onCall?.(input.op.op)
    if (input.op.op === 'metrics.unsubscribe')
      return {
        state: 'ok',
        result: { status: ECallStatus.Ok, op: 'metrics.unsubscribe', value: null },
      }
    await args.awaitSubscribe
    return outcomeOf(args.backlog === undefined ? [] : args.backlog)
  })
  const events = vi.fn((input: { listener: (frame: EventFrame) => void; onClose?: () => void }) => {
    if (!state.held) return null
    state.listener = input.listener
    state.close = input.onClose
    return state.dispose
  })
  const ops = { invoke, events, hold: vi.fn(() => true) }
  return { ops: ops as unknown as PodOps, invoke, events, state }
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
    await new Promise<void>((resolve) => setTimeout(resolve, 1))
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
  ops: PodOps | null
  unheldRecheckMs?: number
}) =>
  new PodMetricsService(args.sessions as unknown as SessionsService, args.ops, args.unheldRecheckMs)

describe('PodMetricsService', () => {
  it('refuses a session the operator does not own', async () => {
    const sessions = sessionsOf()
    sessions.requireOwnedSession.mockImplementationOnce(async () => {
      throw new Error('not yours')
    })
    const { ops } = operationsOf({ held: true })
    await expect(collect(watch(serviceOf({ sessions, ops }))).done).rejects.toThrow('not yours')
  })

  it('refuses the stream when the host is not mounted', async () => {
    const sessions = sessionsOf()
    await expect(collect(watch(serviceOf({ sessions, ops: null }))).done).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
  })

  it('stays open and rechecks while no host of this process holds the pod', async () => {
    const sessions = sessionsOf()
    const { ops, invoke, events, state } = operationsOf({ held: false })
    const abort = new AbortController()
    let finished = false
    const run = collect(watch(serviceOf({ sessions, ops, unheldRecheckMs: 2 }), abort.signal))
    void run.done.then(() => {
      finished = true
    })
    await until(() => events.mock.calls.length >= 3)
    expect(finished).toBe(false)
    expect(run.frames).toEqual([])
    expect(invoke).not.toHaveBeenCalled()
    state.held = true
    await until(() => state.listener !== undefined)
    state.listener?.(frameOf(sample(2_000)))
    await until(() => run.frames.length === 1)
    abort.abort()
    await run.done
    expect(run.frames).toEqual([{ type: 'sample', sample: sample(2_000) }])
  })

  it('yields nothing when the pod cannot read its cgroup counters', async () => {
    const sessions = sessionsOf()
    const { ops } = operationsOf({ held: true, backlog: null })
    const run = collect(watch(serviceOf({ sessions, ops })))
    await run.done
    expect(run.frames).toEqual([])
  })

  it('yields the backlog first and then every live sample once', async () => {
    const sessions = sessionsOf()
    const { ops, state } = operationsOf({ held: true, backlog: [sample(1_000)] })
    const run = collect(watch(serviceOf({ sessions, ops })))
    await until(() => state.listener !== undefined)
    state.listener?.(frameOf(sample(1_500)))
    state.listener?.(frameOf(sample(1_000)))
    state.close?.()
    await run.done
    expect(run.frames).toEqual([
      { type: 'samples', samples: [sample(1_000)] },
      { type: 'sample', sample: sample(1_500) },
    ])
  })

  it('ignores events that are not metrics samples', async () => {
    const sessions = sessionsOf()
    const { ops, state } = operationsOf({ held: true, backlog: [] })
    const run = collect(watch(serviceOf({ sessions, ops })))
    await until(() => state.listener !== undefined)
    state.listener?.({
      kind: 'event',
      event: { type: 'watch.changed', watchId: 'w', paths: ['p'] },
    })
    state.close?.()
    await run.done
    expect(run.frames).toEqual([])
  })

  it('unsubscribes on the pod when the client goes away', async () => {
    const sessions = sessionsOf()
    const calls: string[] = []
    const { ops, state } = operationsOf({ held: true, onCall: (op) => calls.push(op) })
    const abort = new AbortController()
    const run = collect(watch(serviceOf({ sessions, ops }), abort.signal))
    await until(() => state.listener !== undefined)
    abort.abort()
    await run.done
    expect(calls).toEqual(['metrics.subscribe', 'metrics.unsubscribe'])
    expect(state.dispose).toHaveBeenCalled()
  })

  it('unsubscribes when the client goes away before the subscribe answers', async () => {
    const sessions = sessionsOf()
    const calls: string[] = []
    let answer: () => void = () => undefined
    const inFlight = new Promise<void>((resolve) => {
      answer = resolve
    })
    const { ops, state } = operationsOf({
      held: true,
      onCall: (op) => calls.push(op),
      awaitSubscribe: inFlight,
    })
    const abort = new AbortController()
    const run = collect(watch(serviceOf({ sessions, ops }), abort.signal))
    await until(() => calls.includes('metrics.subscribe'))
    abort.abort()
    answer()
    await run.done
    expect(run.frames).toEqual([])
    expect(calls).toEqual(['metrics.subscribe', 'metrics.unsubscribe'])
    expect(state.dispose).toHaveBeenCalled()
  })

  it('does not unsubscribe when it never subscribed', async () => {
    const sessions = sessionsOf()
    const calls: string[] = []
    const { ops } = operationsOf({ held: true, backlog: null, onCall: (op) => calls.push(op) })
    await collect(watch(serviceOf({ sessions, ops }))).done
    expect(calls).toEqual(['metrics.subscribe'])
  })
})
