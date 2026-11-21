import { toStepId, type StepSignal } from '@dltech/atlas-client/channel'
import type { Chunk } from '@dltech/atlas-core'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { createPromptLatency } from '../prompt-latency'

export type Captured = { event: string; props: Record<string, unknown> }

export const START_EPOCH = Date.parse('2026-11-20T10:00:00.000Z')
export const STEP_ID = toStepId('thr_1#1')

export const signalOf = (chunk: Chunk): StepSignal => ({ type: 'chunk', stepId: STEP_ID, chunk })

export const eventOf = (args: { seq: number; type: string; at?: string }): WireEvent => ({
  id: `evt_${args.seq}`,
  threadId: 'thr_1',
  seq: args.seq,
  runId: 'run_1',
  depth: 0,
  at: args.at ?? '2026-11-20T10:00:01.000Z',
  type: args.type,
  body: '{}',
})

export function rig() {
  const captured: Captured[] = []
  const timers: { delayMs: number; run: () => void; cancelled: boolean }[] = []
  let now = 1000
  let epoch = START_EPOCH
  const latency = createPromptLatency({
    now: () => now,
    epoch: () => epoch,
    sink: (event, props) => void captured.push({ event, props }),
    schedule: ({ delayMs, run }) => {
      const timer = { delayMs, run, cancelled: false }
      timers.push(timer)
      return () => void (timer.cancelled = true)
    },
  })
  return {
    latency,
    captured,
    timers,
    advance: (ms: number) => {
      now += ms
      epoch += ms
    },
    at: () => now,
  }
}

export const startOf = (
  overrides?: Partial<Parameters<ReturnType<typeof rig>['latency']['begin']>[0]>,
) => ({
  threadId: 'thr_1',
  sendId: 'snd_1',
  podState: 'running',
  turnWasRunning: false,
  ...overrides,
})
