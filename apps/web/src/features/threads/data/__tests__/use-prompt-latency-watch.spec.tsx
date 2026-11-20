import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { threadOf } from '@/features/shell/__tests__/fixtures'
import type { WireEvent, WireThread } from '@dltech/atlas-wire/web'

import type { PolledThreadEvents } from '../use-thread-events'
import { IDLE_LIVE_THREAD } from '../live-thread-view'
import {
  createPromptLatency,
  PROMPT_FIRST_OUTPUT,
  PROMPT_TURN_STARTED,
  type PromptLatency,
} from '../prompt-latency'
import { createThreadSignalHub, type ThreadSignalHub } from '../thread-signal-hub'
import { threadSourceOf } from '../thread-source'
import { usePromptLatencyWatch } from '../use-prompt-latency-watch'

const START_EPOCH = Date.parse('2026-11-20T10:00:00.000Z')

const eventOf = (args: { seq: number; type: string; at: number }): WireEvent => ({
  id: `evt_${args.seq}`,
  threadId: 'thr_1',
  seq: args.seq,
  runId: 'run_1',
  depth: 0,
  at: new Date(args.at).toISOString(),
  type: args.type,
  body: '{}',
})

const polledOf = (events: WireEvent[]): PolledThreadEvents => ({
  events,
  loaded: true,
  error: null,
  poke: () => undefined,
})

const factsOf = (working: boolean): NonNullable<WireThread['status']> => ({
  working,
  awaiting: null,
  lastOutcome: null,
  podState: 'running',
  lastAssistantSeq: 0,
  readSeq: null,
})

const latencyOf = (captured: string[]): PromptLatency =>
  createPromptLatency({
    now: () => 1000,
    epoch: () => START_EPOCH,
    sink: (event) => void captured.push(event),
    schedule: () => () => undefined,
  })

const beginOf = (latency: PromptLatency): void =>
  latency.begin({
    threadId: 'thr_1',
    sendId: 'snd_1',
    podState: 'running',
    turnWasRunning: false,
  })

type ProbeProps = { hub: ThreadSignalHub; latency: PromptLatency; events: readonly WireEvent[] }

function Probe(props: ProbeProps) {
  usePromptLatencyWatch({
    threadId: 'thr_1',
    signals: props.hub,
    events: props.events,
    latency: props.latency,
  })
  return null
}

async function mount(first: ProbeProps) {
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  const render = async (next: ProbeProps) => {
    await act(async () => root.render(<Probe {...next} />))
  }
  await render(first)
  return {
    render,
    unmount: async () => {
      await act(async () => root.unmount())
    },
  }
}

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

describe('usePromptLatencyWatch', () => {
  it('fires when polled history first shows assistant output', async () => {
    const captured: string[] = []
    const latency = latencyOf(captured)
    beginOf(latency)
    const hub = createThreadSignalHub()
    const empty = threadSourceOf({ live: IDLE_LIVE_THREAD, polled: polledOf([]) })
    const mounted = await mount({ hub, latency, events: empty.events })

    expect(captured).toEqual([])

    const shown = threadSourceOf({
      live: IDLE_LIVE_THREAD,
      polled: polledOf([eventOf({ seq: 2, type: 'assistant-said', at: START_EPOCH + 4000 })]),
    })
    await mounted.render({ hub, latency, events: shown.events })
    expect(captured).toEqual([PROMPT_FIRST_OUTPUT])

    await mounted.render({ hub, latency, events: shown.events })
    expect(captured).toEqual([PROMPT_FIRST_OUTPUT])

    await mounted.unmount()
  })

  it('fires turn started from the status frame when no live channel attached', async () => {
    const captured: string[] = []
    const latency = latencyOf(captured)
    beginOf(latency)
    const hub = createThreadSignalHub()
    const mounted = await mount({ hub, latency, events: [] })

    await act(async () => {
      hub.emitMeta({ thread: threadOf({ id: 'thr_1', status: factsOf(true) }), rev: 1 })
    })
    await act(async () => {
      hub.emitMeta({ thread: threadOf({ id: 'thr_1', status: factsOf(true) }), rev: 2 })
    })
    await act(async () => {
      hub.emitMeta({ thread: threadOf({ id: 'mate', status: factsOf(true) }), rev: 3 })
    })

    expect(captured).toEqual([PROMPT_TURN_STARTED])
    await mounted.unmount()
  })
})
