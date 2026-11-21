import { describe, expect, it } from 'bun:test'

import { EStepEnd } from '@dltech/atlas-client/channel'
import { EFinishReason, toCallId, type Chunk } from '@dltech/atlas-core'

import {
  EPromptPath,
  PROMPT_FIRST_OUTPUT,
  PROMPT_LATENCY_TTL_MS,
  PROMPT_TURN_STARTED,
} from '../prompt-latency'

import { eventOf, rig, signalOf, startOf, STEP_ID } from './prompt-latency.rig'

describe('createPromptLatency', () => {
  it('emits turn started and first output once each, timed from the send', () => {
    const test = rig()
    test.latency.begin(startOf())
    test.latency.markPath({ threadId: 'thr_1', sendId: 'snd_1', path: EPromptPath.Live })
    test.advance(850)
    test.latency.turnStarted({ threadId: 'thr_1' })
    test.advance(2400)
    test.latency.firstOutput({ threadId: 'thr_1' })
    test.latency.firstOutput({ threadId: 'thr_1' })
    test.latency.turnStarted({ threadId: 'thr_1' })

    expect(test.captured).toEqual([
      {
        event: PROMPT_TURN_STARTED,
        props: { latency_ms: 850, path: 'live', pod_state: 'running' },
      },
      {
        event: PROMPT_FIRST_OUTPUT,
        props: { latency_ms: 3250, path: 'live', pod_state: 'running' },
      },
    ])
  })

  it('reports the queued path when the live send fell through', () => {
    const test = rig()
    test.latency.begin(startOf({ podState: 'booting' }))
    test.latency.markPath({ threadId: 'thr_1', sendId: 'snd_1', path: EPromptPath.Queued })
    test.advance(120)
    test.latency.turnStarted({ threadId: 'thr_1' })

    expect(test.captured).toEqual([
      {
        event: PROMPT_TURN_STARTED,
        props: { latency_ms: 120, path: 'queued', pod_state: 'booting' },
      },
    ])
  })

  it('flags a prompt queued into a running turn as live and still measures first output', () => {
    const test = rig()
    test.latency.begin(startOf({ turnWasRunning: true }))
    test.advance(70)
    test.latency.firstOutput({ threadId: 'thr_1' })

    expect(test.captured).toEqual([
      {
        event: PROMPT_FIRST_OUTPUT,
        props: { latency_ms: 70, path: 'live', pod_state: 'running', turn_was_running: true },
      },
    ])
  })

  it('keeps the first pending send when a second one starts on the same thread', () => {
    const test = rig()
    test.latency.begin(startOf())
    test.advance(30)
    test.latency.begin(startOf({ sendId: 'snd_2' }))
    test.advance(970)
    test.latency.firstOutput({ threadId: 'thr_1' })

    expect(test.captured).toEqual([
      {
        event: PROMPT_FIRST_OUTPUT,
        props: { latency_ms: 1000, path: 'queued', pod_state: 'running' },
      },
    ])
  })

  it('drops the measurement on send failure', () => {
    const test = rig()
    test.latency.begin(startOf())
    test.latency.drop({ threadId: 'thr_1' })
    test.latency.turnStarted({ threadId: 'thr_1' })
    test.latency.firstOutput({ threadId: 'thr_1' })

    expect(test.captured).toEqual([])
    expect(test.timers.every((timer) => timer.cancelled)).toBe(true)
  })

  it('drops the measurement after fifteen minutes', () => {
    const test = rig()
    test.latency.begin(startOf())
    expect(test.timers[0]?.delayMs).toBe(PROMPT_LATENCY_TTL_MS)

    test.timers[0]?.run()
    test.advance(PROMPT_LATENCY_TTL_MS)
    test.latency.turnStarted({ threadId: 'thr_1' })

    expect(test.captured).toEqual([])
  })

  it('credits the first assistant event written after the send', () => {
    const test = rig()
    test.latency.begin(startOf())
    test.latency.markPath({ threadId: 'thr_1', sendId: 'snd_1', path: EPromptPath.Queued })
    test.advance(4000)

    test.latency.sawEvents({
      threadId: 'thr_1',
      events: [eventOf({ seq: 1, type: 'user-said', at: '2026-11-20T09:59:00.000Z' })],
    })
    expect(test.captured).toEqual([])

    test.latency.sawEvents({
      threadId: 'thr_1',
      events: [
        eventOf({ seq: 2, type: 'assistant-said', at: '2026-11-20T09:59:30.000Z' }),
        eventOf({ seq: 3, type: 'user-said', at: '2026-11-20T10:00:02.000Z' }),
      ],
    })
    expect(test.captured).toEqual([])

    test.latency.sawEvents({
      threadId: 'thr_1',
      events: [eventOf({ seq: 4, type: 'assistant-said', at: '2026-11-20T10:00:03.000Z' })],
    })
    expect(test.captured).toEqual([
      {
        event: PROMPT_FIRST_OUTPUT,
        props: { latency_ms: 4000, path: 'queued', pod_state: 'running' },
      },
    ])
  })

  it('measures a second send once the first has retired', () => {
    const test = rig()
    test.latency.begin(startOf())
    test.advance(200)
    test.latency.turnStarted({ threadId: 'thr_1' })
    test.advance(800)
    test.latency.firstOutput({ threadId: 'thr_1' })

    test.latency.begin(startOf({ sendId: 'snd_2' }))
    test.advance(50)
    test.latency.turnStarted({ threadId: 'thr_1' })
    test.advance(450)
    test.latency.firstOutput({ threadId: 'thr_1' })

    expect(test.captured).toEqual([
      {
        event: PROMPT_TURN_STARTED,
        props: { latency_ms: 200, path: 'queued', pod_state: 'running' },
      },
      {
        event: PROMPT_FIRST_OUTPUT,
        props: { latency_ms: 1000, path: 'queued', pod_state: 'running' },
      },
      {
        event: PROMPT_TURN_STARTED,
        props: { latency_ms: 50, path: 'queued', pod_state: 'running' },
      },
      {
        event: PROMPT_FIRST_OUTPUT,
        props: { latency_ms: 500, path: 'queued', pod_state: 'running' },
      },
    ])
    expect(test.timers[0]?.cancelled).toBe(true)
  })

  it('ignores a second run of the same send that already retired', () => {
    const test = rig()
    test.latency.begin(startOf())
    test.advance(100)
    test.latency.turnStarted({ threadId: 'thr_1' })
    test.latency.firstOutput({ threadId: 'thr_1' })

    test.latency.begin(startOf())
    test.latency.turnStarted({ threadId: 'thr_1' })
    test.latency.firstOutput({ threadId: 'thr_1' })

    expect(test.captured.map((entry) => entry.event)).toEqual([
      PROMPT_TURN_STARTED,
      PROMPT_FIRST_OUTPUT,
    ])
  })

  it('credits text, reasoning and tool call chunks, and nothing else', () => {
    const visible: Chunk[] = [
      { type: 'text-delta', id: 't1', text: 'hi' },
      { type: 'reasoning-delta', id: 'r1', text: 'hmm' },
      { type: 'tool-input-start', callId: toCallId('call_1'), name: 'read' },
      { type: 'tool-call', callId: toCallId('call_2'), name: 'read', input: {} },
    ]
    const invisible: Chunk[] = [
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', text: '' },
      { type: 'text-end', id: 't1' },
      { type: 'reasoning-start', id: 'r1' },
      { type: 'reasoning-end', id: 'r1' },
      { type: 'tool-input-delta', callId: toCallId('call_1'), text: '{}' },
      { type: 'tool-input-end', callId: toCallId('call_1') },
      { type: 'finish', reason: EFinishReason.Stop },
      { type: 'error', message: 'provider exploded' },
    ]

    for (const [index, chunk] of [...visible, ...invisible].entries()) {
      const test = rig()
      test.latency.begin(startOf({ sendId: `snd_${index}` }))
      test.advance(300)
      test.latency.sawSignal({ threadId: 'thr_1', signal: signalOf(chunk) })
      const expected = index < visible.length ? [PROMPT_FIRST_OUTPUT] : []
      expect(test.captured.map((entry) => entry.event)).toEqual(expected)
    }
  })

  it('gives no first output for a failed step that streamed nothing', () => {
    const test = rig()
    test.latency.begin(startOf())
    test.latency.sawSignal({
      threadId: 'thr_1',
      signal: { type: 'step-started', stepId: STEP_ID },
    })
    test.latency.sawSignal({
      threadId: 'thr_1',
      signal: signalOf({ type: 'error', message: 'provider exploded' }),
    })
    expect(test.captured).toEqual([])

    test.latency.sawSignal({
      threadId: 'thr_1',
      signal: { type: 'step-ended', stepId: STEP_ID, end: EStepEnd.Failed, supersededBy: null },
    })
    test.advance(10)
    test.latency.turnStarted({ threadId: 'thr_1' })
    test.latency.firstOutput({ threadId: 'thr_1' })

    expect(test.captured).toEqual([])
    expect(test.timers.every((timer) => timer.cancelled)).toBe(true)
  })

  it('drops the measurement when the turn failed in history before any output', () => {
    const test = rig()
    test.latency.begin(startOf())
    test.latency.sawEvents({
      threadId: 'thr_1',
      events: [eventOf({ seq: 2, type: 'run-failed', at: '2026-11-20T10:00:04.000Z' })],
    })
    test.advance(10)
    test.latency.turnStarted({ threadId: 'thr_1' })

    expect(test.captured).toEqual([])
    expect(test.timers.every((timer) => timer.cancelled)).toBe(true)
  })
})
