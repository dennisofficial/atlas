import { describe, expect, it } from 'bun:test'

import { toRunId, toThreadId } from '../../../events/ids'
import { chainEvents } from '../../chain-events'
import type { V2Body } from '../../event'
import { initialMeterState, meterOf, rebuildMeter, stepMeter } from '../meter-state'

const WINDOW = 200_000
const threadId = toThreadId('thread-meter')
const runId = toRunId('run-meter')
const AT = '2026-11-20T00:00:00.000Z'

const logOf = (bodies: readonly V2Body[]) =>
  chainEvents({ threadId, runId, epoch: 1, at: AT, bodies })

const said = (inputTokens: number): V2Body => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text: 'ok' }],
  usage: { inputTokens, outputTokens: 1_000, contextWindow: WINDOW },
})

const rotated: V2Body = { type: 'rotated', handoff: 'the brief' }

const recovered = { ...initialMeterState, window: WINDOW }

describe('the context meter across a rotation', () => {
  it('drops the reading and keeps the window', () => {
    const events = logOf([said(120_000), rotated])
    const state = events.reduce(stepMeter, initialMeterState)

    expect(meterOf(state)).toEqual({ used: null, window: WINDOW, measuredThroughSeq: null })
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
    })
  })
})
