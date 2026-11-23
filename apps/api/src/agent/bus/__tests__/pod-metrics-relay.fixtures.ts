import { vi } from 'bun:test'
import type { EventFrame, PodCallOutcome } from '@dltech/atlas-host'
import type { LogPort } from '@dltech/atlas-observability'
import {
  ECallFailure,
  ECallStatus,
  ELiveOpFailure,
  type PodMetricsFrame,
  type PodMetricsWatch,
  type PodSample,
} from '@dltech/atlas-protocol'

import type { PodOps } from '../../host/pod-ops'
import type { PodMetricsBus } from '../pod-metrics-bus'
import { PodMetricsRelay } from '../pod-metrics-relay'

export const sample = (at: number): PodSample => ({
  at,
  cpuPercent: 12.5,
  ramBytes: 1024,
  ramLimitBytes: 2048,
  throttled: false,
  oomKills: 0,
})

export const frameOf = (payload: PodSample): EventFrame => ({
  kind: 'event',
  event: { type: 'metrics.sample', sample: payload },
})

export const outcomeOf = (value: PodSample[] | null): PodCallOutcome =>
  value === null
    ? { state: 'unavailable', reason: ELiveOpFailure.Asleep }
    : {
        state: 'ok',
        result: { status: ECallStatus.Ok, op: 'metrics.subscribe', value: { samples: value } },
      }

export const busOf = () => {
  const watchListeners = new Set<(request: PodMetricsWatch) => void>()
  const frames: { sessionId: string; frame: PodMetricsFrame }[] = []
  const bus: Pick<PodMetricsBus, 'onWatch' | 'publish'> & {
    requestWatch(request: PodMetricsWatch): Promise<void>
  } = {
    onWatch(listener) {
      watchListeners.add(listener)
      return () => {
        watchListeners.delete(listener)
      }
    },
    async publish(args) {
      frames.push(args)
    },
    async requestWatch(request) {
      for (const listener of [...watchListeners]) listener(request)
    },
  }
  return { bus, frames }
}

export const operationsOf = (args: {
  held: boolean
  holder?: boolean
  backlog?: PodSample[] | null
  subscribeFailure?: string | undefined
}) => {
  const calls: string[] = []
  const holders = { value: args.holder ?? args.held }
  const state: {
    listener: ((frame: EventFrame) => void) | undefined
    close: (() => void) | undefined
    dispose: ReturnType<typeof vi.fn>
  } = { listener: undefined, close: undefined, dispose: vi.fn() }
  const invoke = vi.fn(async (input: { op: { op: string } }) => {
    calls.push(input.op.op)
    if (input.op.op === 'metrics.unsubscribe')
      return {
        state: 'ok',
        result: { status: ECallStatus.Ok, op: 'metrics.unsubscribe', value: null },
      }
    if (args.subscribeFailure !== undefined)
      return {
        state: 'ok',
        result: {
          status: ECallStatus.Failed,
          op: 'metrics.subscribe',
          error: { code: ECallFailure.Internal, message: args.subscribeFailure },
        },
      }
    return outcomeOf(args.backlog === undefined ? [] : args.backlog)
  })
  const hold = vi.fn((_input: { sessionId: string; ttlMs?: number }) => true)
  const servesLocally = vi.fn(async (_input: { sessionId: string }) => holders.value)
  const events = vi.fn((input: { listener: (frame: EventFrame) => void; onClose?: () => void }) => {
    if (!args.held) return null
    state.listener = input.listener
    state.close = input.onClose
    return state.dispose
  })
  const ops = { events, invoke, hold, servesLocally } as unknown as Pick<
    PodOps,
    'events' | 'hold' | 'invoke' | 'servesLocally'
  >
  return { ops, invoke, events, hold, servesLocally, holders, state, calls }
}

export const relayOf = (args: {
  ops: Pick<PodOps, 'events' | 'hold' | 'invoke' | 'servesLocally'>
  bus: Pick<PodMetricsBus, 'onWatch' | 'publish'>
  log?: LogPort
}) => {
  const relay = new PodMetricsRelay(args)
  relay.onModuleInit()
  return relay
}

export const watch = (
  bus: { requestWatch(request: PodMetricsWatch): Promise<void> },
  args: {
    sessionId?: string
    watcherId: string
    ttlMs: number
  },
) =>
  bus.requestWatch({
    sessionId: args.sessionId ?? 's1',
    watcherId: args.watcherId,
    ttlMs: args.ttlMs,
  })
