import { describe, expect, it } from 'bun:test'

import type { StepReading } from '../../../events/body'
import { toRunId, toThreadId } from '../../../events/ids'
import type { SpendRow } from '../../../models/spend-tally'
import { chainEvents } from '../../chain-events'
import type { V2Body } from '../../event'
import { initialSpendState, stepSpend, type SpendState } from '../spend'

const THREAD = toThreadId('t')
const RUN = toRunId('r')
const AT = '2026-11-20T00:00:00.000Z'

const STEADY: StepReading = {
  inputTokens: 1_000,
  outputTokens: 100,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

const NAMED: StepReading = { ...STEADY, providerId: 'anthropic', modelId: 'claude-sonnet-4-5' }

const folding = (readings: readonly StepReading[], from: SpendState = initialSpendState) =>
  chainEvents({
    threadId: THREAD,
    runId: RUN,
    epoch: 1,
    at: AT,
    bodies: readings.map((usage): V2Body => ({ type: 'assistant-said', parts: [], usage })),
  }).reduce(stepSpend, from)

const only = (state: SpendState): SpendRow => {
  const [row] = state.rows
  if (row === undefined) throw new Error('expected a spend row')
  return row
}

const UNPRICED_STEADY = {
  inputTokens: STEADY.inputTokens,
  outputTokens: STEADY.outputTokens,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

describe('folding a step into the spend rows', () => {
  it('sums the cost each step stated', () => {
    const row = only(
      folding([
        { ...NAMED, costUsd: 0.25 },
        { ...NAMED, costUsd: 0.5 },
      ]),
    )

    expect(row.costUsd).toBeCloseTo(0.75)
    expect(row.inputTokens).toBe(2_000)
  })

  it('keeps the tokens of a step with no stated cost as the unpriced remainder', () => {
    const row = only(folding([{ ...NAMED, costUsd: 0.25 }, NAMED]))

    expect(row.costUsd).toBeCloseTo(0.25)
    expect(row.unpricedTokens).toEqual(UNPRICED_STEADY)
  })

  it('states a row with no stored cost at all as wholly unpriced', () => {
    const row = only(folding([NAMED]))

    expect(row).not.toHaveProperty('costUsd')
    expect(row.unpricedTokens).toEqual(UNPRICED_STEADY)
  })

  it('counts a row recorded before steps carried costs as unpriced when a new step lands on it', () => {
    const legacy: SpendState = {
      rows: [
        {
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-5',
          inputTokens: 300,
          outputTokens: 30,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      ],
    }
    const row = only(folding([{ ...NAMED, costUsd: 0.25 }], legacy))

    expect(row.costUsd).toBeCloseTo(0.25)
    expect(row.unpricedTokens).toEqual({
      inputTokens: 300,
      outputTokens: 30,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })

  it('keeps one row per provider and model', () => {
    const state = folding([NAMED, { ...STEADY, providerId: 'openai', modelId: 'gpt-5' }, NAMED])

    expect(state.rows.map((row) => `${row.providerId}/${row.modelId}`)).toEqual([
      'anthropic/claude-sonnet-4-5',
      'openai/gpt-5',
    ])
  })
})
