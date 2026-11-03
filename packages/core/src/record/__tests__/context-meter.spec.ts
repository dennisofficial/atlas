import { describe, expect, it } from 'bun:test'

import { estimateTextTokens } from '../../assembly/tokens'
import { estimateBodyTokens } from '../../models/usage'
import { ECompactionAnchor } from '../../events/body'
import { toCallId } from '../../events/ids'
import { chainEvents } from '../chain-events'
import { contextMeterOf, EMeterBasis } from '../context-meter'
import type { V2Body } from '../event'
import { NOW, runId, threadId } from './support'

const WINDOW = 200_000

const logOf = (bodies: readonly V2Body[]) =>
  chainEvents({ threadId, runId, epoch: 1, at: NOW, bodies })

const said = (inputTokens: number, outputTokens = 100): V2Body => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text: 'ok' }],
  usage: { inputTokens, outputTokens, contextWindow: WINDOW },
})

const called = (id: string, inputTokens?: number): V2Body => ({
  type: 'tool-called',
  callId: toCallId(id),
  name: 'bash',
  input: {},
  ordinal: 0,
  ...(inputTokens === undefined
    ? {}
    : { usage: { inputTokens, outputTokens: 50, contextWindow: WINDOW } }),
})

const result = (id: string, text: string): Extract<V2Body, { type: 'tool-result' }> => ({
  type: 'tool-result',
  callId: toCallId(id),
  name: 'bash',
  output: text,
})

describe('the v2 context meter', () => {
  it('estimates the visible log before any call reported', () => {
    const meter = contextMeterOf(logOf([{ type: 'user-said', text: 'x'.repeat(400) }]))
    expect(meter).toEqual({
      used: 100,
      window: null,
      basis: EMeterBasis.Estimated,
      measuredThroughSeq: null,
      estimatedTokens: 100,
    })
  })

  it('reads input plus output of the last call against the window it ran in', () => {
    const meter = contextMeterOf(logOf([{ type: 'user-said', text: 'hi' }, said(40_000, 2_000)]))
    expect(meter).toMatchObject({
      used: 42_000,
      window: WINDOW,
      basis: EMeterBasis.Measured,
      measuredThroughSeq: 2,
      estimatedTokens: 0,
    })
  })

  it('rises between calls with what landed since the last reading', () => {
    const landed = result('c1', 'y'.repeat(800))
    const meter = contextMeterOf(logOf([called('c1', 10_000), landed]))
    const landedTokens = estimateBodyTokens(landed)
    expect(landedTokens).toBeGreaterThan(0)
    expect(meter).toMatchObject({
      basis: EMeterBasis.Measured,
      estimatedTokens: landedTokens,
      used: 10_050 + landedTokens,
    })
  })

  it('does not count the sibling calls of the step that carries the reading', () => {
    const meter = contextMeterOf(logOf([called('c1', 10_000), called('c2'), called('c3')]))
    expect(meter.used).toBe(10_050)
  })

  it('takes the latest call, so it climbs call by call', () => {
    const meter = contextMeterOf(logOf([said(10_000), said(30_000)]))
    expect(meter.used).toBe(30_100)
  })

  it('falls back to an earlier reading when a rewind hides the later one', () => {
    const meter = contextMeterOf(
      logOf([said(10_000), said(90_000), { type: 'history-rewound', toSeq: 1 }]),
    )
    expect(meter).toMatchObject({ used: 10_100, measuredThroughSeq: 1 })
  })

  it('voids the reading a later summary made stale and estimates the shrunk context', () => {
    const summary = 's'.repeat(400)
    const meter = contextMeterOf(
      logOf([
        { type: 'user-said', text: 'x'.repeat(4_000) },
        said(90_000),
        {
          type: 'history-summarised',
          fromSeq: 1,
          throughSeq: 2,
          anchor: ECompactionAnchor.Prefix,
          summary,
        },
      ]),
    )
    expect(meter).toMatchObject({
      basis: EMeterBasis.Estimated,
      used: estimateTextTokens(summary),
      window: WINDOW,
    })
  })

  it('measures again once a call reports after the summary', () => {
    const meter = contextMeterOf(
      logOf([
        said(90_000),
        {
          type: 'history-summarised',
          fromSeq: 1,
          throughSeq: 1,
          anchor: ECompactionAnchor.Prefix,
          summary: 'short',
        },
        said(5_000),
      ]),
    )
    expect(meter).toMatchObject({ basis: EMeterBasis.Measured, used: 5_100, window: WINDOW })
  })
})
