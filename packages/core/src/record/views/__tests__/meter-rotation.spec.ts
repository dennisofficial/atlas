import { describe, expect, it } from 'bun:test'

import { toRunId, toThreadId } from '../../../events/ids'
import { chainEvents } from '../../chain-events'
import type { RecordEventBody } from '../../event'
import { initialMeterState, meterOf, rebuildMeter, stepMeter } from '../meter-state'

const WINDOW = 200_000
const threadId = toThreadId('thread-meter')
const runId = toRunId('run-meter')
const AT = '2026-11-20T00:00:00.000Z'

const logOf = (bodies: readonly RecordEventBody[]) =>
  chainEvents({ threadId, runId, epoch: 1, at: AT, bodies })

const said = (inputTokens: number): RecordEventBody => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text: 'ok' }],
  usage: { inputTokens, outputTokens: 1_000, contextWindow: WINDOW },
})

const rotated: RecordEventBody = { type: 'rotated', handoff: 'the brief' }

const recovered = { ...initialMeterState, window: WINDOW }

describe('the context meter across a rotation', () => {
  it('drops the reading and keeps the window', () => {
    const events = logOf([said(120_000), rotated])
    const state = events.reduce(stepMeter, initialMeterState)

    expect(meterOf(state)).toEqual({
      used: null,
      window: WINDOW,
      measuredThroughSeq: null,
      breakdown: null,
    })
  })

  it('agrees when rebuilt from the visible tail', () => {
    const events = logOf([said(120_000), rotated])
    const state = events.reduce(stepMeter, initialMeterState)

    expect(rebuildMeter({ state: recovered, visibleTail: events })).toEqual(state)
  })

  it('reads again from a call after the boundary', () => {
    const events = logOf([said(120_000), rotated, said(30_000)])
    const state = events.reduce(stepMeter, initialMeterState)

    expect(meterOf(state)).toEqual({
      used: 31_000,
      window: WINDOW,
      measuredThroughSeq: 3,
      breakdown: null,
    })
  })

  it('keeps the breakdown a reading carried, and agrees when rebuilt', () => {
    const breakdown = [{ label: 'Tools', tokens: 120 }]
    const withBreakdown: RecordEventBody = {
      type: 'assistant-said',
      parts: [{ type: 'text', text: 'ok' }],
      usage: { inputTokens: 120, outputTokens: 0, contextWindow: WINDOW, breakdown },
    }
    const events = logOf([withBreakdown])
    const state = events.reduce(stepMeter, initialMeterState)

    expect(meterOf(state)?.breakdown).toEqual(breakdown)
    expect(rebuildMeter({ state: recovered, visibleTail: events })).toEqual(state)
  })
})
