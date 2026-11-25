import { describe, expect, it } from 'bun:test'

import type { PodAnalytics, PodAnalyticsValue } from '@dltech/atlas-plugin-sdk'
import {
  ECallStatus,
  type CallOp,
  type CallResult,
  type PodSample as ProtocolSample,
} from '@dltech/atlas-protocol'

import type { EventFrame, RemoteHello } from '../../calls/remote-calls'
import { POD_SAMPLE_WINDOW_MS, PodSampleObserver } from '../pod-sample-observer'
import { FakeClock } from './rig-fakes'

const TURN_START = 1_000

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const sampleOf = (over: Partial<ProtocolSample> = {}): ProtocolSample => ({
  at: 0,
  cpuPercent: 0,
  ramBytes: 0,
  ramLimitBytes: null,
  throttled: false,
  oomKills: 0,
  ...over,
})

type Captured = { event: string; properties: Readonly<Record<string, PodAnalyticsValue>> }

const recorder = (): { captured: Captured[]; analytics: PodAnalytics } => {
  const captured: Captured[] = []
  return {
    captured,
    analytics: {
      capture: ({ event, properties }) => {
        captured.push({ event, properties })
      },
    },
  }
}

class FakeCalls {
  readonly listeners = new Set<(frame: EventFrame) => void>()
  readonly readyListeners = new Set<(hello: RemoteHello) => void>()
  readonly ops: CallOp['op'][] = []
  readonly acked: string[] = []
  backlog: readonly ProtocolSample[] = []
  failSubscribe = false

  onEvent(listener: (frame: EventFrame) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  onReady(listener: (hello: RemoteHello) => void): () => void {
    this.readyListeners.add(listener)
    return () => {
      this.readyListeners.delete(listener)
    }
  }

  invoke(args: { key: string; op: CallOp }): Promise<CallResult> {
    this.ops.push(args.op.op)
    if (args.op.op === 'metrics.subscribe') {
      if (this.failSubscribe) return Promise.reject(new Error('daemon refused'))
      return Promise.resolve({
        status: ECallStatus.Ok,
        op: 'metrics.subscribe',
        value: { samples: [...this.backlog] },
      })
    }
    if (args.op.op === 'metrics.unsubscribe') {
      return Promise.resolve({ status: ECallStatus.Ok, op: 'metrics.unsubscribe', value: null })
    }
    return Promise.reject(new Error(`unexpected op ${args.op.op}`))
  }

  ack(args: { key: string }): Promise<void> {
    this.acked.push(args.key)
    return Promise.resolve()
  }

  emit(sample: ProtocolSample): void {
    for (const listener of [...this.listeners]) {
      listener({ kind: 'event', event: { type: 'metrics.sample', sample } })
    }
  }

  ready(): void {
    for (const listener of [...this.readyListeners]) listener({ bootId: 'boot-1', restart: true })
  }
}

const rigOf = (args: { analytics?: PodAnalytics | undefined; windowMs?: number } = {}) => {
  const clock = new FakeClock()
  const calls = new FakeCalls()
  const recorderOut = recorder()
  const observer = new PodSampleObserver({
    remoteCalls: calls,
    analytics: 'analytics' in args ? args.analytics : recorderOut.analytics,
    timers: clock,
    ...(args.windowMs === undefined ? {} : { windowMs: args.windowMs }),
  })
  clock.current = TURN_START
  return { clock, calls, captured: recorderOut.captured, observer }
}

describe('PodSampleObserver', () => {
  it('subscribes once when a turn starts and captures nothing yet', async () => {
    const { calls, captured, observer } = rigOf()
    await observer.turnStarted()
    expect(calls.ops).toEqual(['metrics.subscribe'])
    expect(calls.acked).toHaveLength(1)
    expect(captured).toEqual([])
  })

  it('captures one sample event per elapsed window', async () => {
    const { clock, calls, captured, observer } = rigOf()
    await observer.turnStarted()
    clock.current = 1_500
    calls.emit(sampleOf({ at: 1_500, cpuPercent: 40, ramBytes: 1_000, ramLimitBytes: 2_000 }))
    clock.current = 2_000
    calls.emit(
      sampleOf({
        at: 2_000,
        cpuPercent: 60,
        ramBytes: 1_000,
        ramLimitBytes: 2_000,
        throttled: true,
      }),
    )

    clock.advance(POD_SAMPLE_WINDOW_MS)

    expect(captured).toEqual([
      {
        event: 'pod_resource_sample',
        properties: {
          window_ms: 60_000,
          samples: 2,
          ram_peak_bytes: 1_000,
          ram_avg_bytes: 1_000,
          ram_limit_bytes: 2_000,
          ram_peak_ratio: 0.5,
          cpu_peak_percent: 60,
          cpu_avg_percent: 50,
          throttled_ratio: 0.5,
          oom_kills: 0,
        },
      },
    ])
  })

  it('starts a fresh window after each flush', async () => {
    const { clock, calls, captured, observer } = rigOf()
    await observer.turnStarted()
    calls.emit(sampleOf({ at: 1_500, cpuPercent: 10 }))
    clock.advance(POD_SAMPLE_WINDOW_MS)
    calls.emit(sampleOf({ at: 61_500, cpuPercent: 20 }))
    clock.advance(POD_SAMPLE_WINDOW_MS)

    expect(captured.map((entry) => entry.properties.cpu_peak_percent)).toEqual([10, 20])
  })

  it('carries the oom counter from one window into the next', async () => {
    const { clock, calls, captured, observer } = rigOf()
    await observer.turnStarted()
    calls.emit(sampleOf({ at: 1_500, oomKills: 5 }))
    calls.emit(sampleOf({ at: 2_000, oomKills: 6 }))
    clock.advance(POD_SAMPLE_WINDOW_MS)
    calls.emit(sampleOf({ at: 61_500, oomKills: 7 }))
    calls.emit(sampleOf({ at: 62_000, oomKills: 9 }))
    clock.advance(POD_SAMPLE_WINDOW_MS)

    expect(captured.map((entry) => entry.properties.oom_kills)).toEqual([1, 3])
  })

  it('captures the partial window at turn end and unsubscribes once', async () => {
    const { clock, calls, captured, observer } = rigOf()
    await observer.turnStarted()
    calls.emit(sampleOf({ at: 5_000, cpuPercent: 30 }))
    clock.current = 21_000

    await observer.turnEnded()
    await observer.turnEnded()

    expect(captured.map((entry) => entry.properties)).toMatchObject([
      { window_ms: 20_000, samples: 1, cpu_peak_percent: 30 },
    ])
    expect(calls.ops).toEqual(['metrics.subscribe', 'metrics.unsubscribe'])
  })

  it('sends nothing between turns', async () => {
    const { clock, calls, captured } = rigOf()
    calls.emit(sampleOf({ at: 1_500 }))
    clock.advance(POD_SAMPLE_WINDOW_MS)
    expect(calls.ops).toEqual([])
    expect(captured).toEqual([])
  })

  it('ignores the subscribe backlog and samples stamped before the turn', async () => {
    const { clock, calls, captured, observer } = rigOf()
    calls.backlog = [sampleOf({ at: 500, cpuPercent: 90 })]
    await observer.turnStarted()
    calls.emit(sampleOf({ at: 900, cpuPercent: 90 }))
    clock.advance(POD_SAMPLE_WINDOW_MS)
    expect(captured).toEqual([])
  })

  it('resubscribes after the pod reconnects mid-turn', async () => {
    const { calls, observer } = rigOf()
    await observer.turnStarted()
    calls.ready()
    await settle()
    expect(calls.ops).toEqual(['metrics.subscribe', 'metrics.subscribe'])
  })

  it('does not subscribe when the runtime has no analytics', async () => {
    const { clock, calls, captured, observer } = rigOf({ analytics: undefined })
    await observer.turnStarted()
    calls.emit(sampleOf({ at: 1_500 }))
    clock.advance(POD_SAMPLE_WINDOW_MS)
    await observer.turnEnded()
    expect(calls.ops).toEqual([])
    expect(captured).toEqual([])
  })

  it('stays inert and silent when the subscribe fails', async () => {
    const { clock, calls, captured, observer } = rigOf()
    calls.failSubscribe = true
    await expect(observer.turnStarted()).resolves.toBeUndefined()
    calls.emit(sampleOf({ at: 1_500 }))
    clock.advance(POD_SAMPLE_WINDOW_MS)
    await expect(observer.turnEnded()).resolves.toBeUndefined()
    expect(captured).toEqual([])
    expect(calls.ops).toEqual(['metrics.subscribe'])
  })

  it('stops idempotently and unsubscribes the pod once', async () => {
    const { calls, observer } = rigOf()
    await observer.turnStarted()
    await observer.stop()
    await observer.stop()
    expect(calls.ops).toEqual(['metrics.subscribe', 'metrics.unsubscribe'])
  })

  it('stops a running turn without capturing', async () => {
    const { clock, calls, captured, observer } = rigOf()
    await observer.turnStarted()
    calls.emit(sampleOf({ at: 1_500 }))
    clock.advance(POD_SAMPLE_WINDOW_MS)
    captured.length = 0
    calls.emit(sampleOf({ at: 61_500 }))
    await observer.stop()
    clock.advance(POD_SAMPLE_WINDOW_MS)
    expect(captured).toEqual([])
  })
})
