import { describe, expect, it } from 'bun:test'

import { toRunId, toThreadId, type ThreadId } from '@dltech/atlas-core'

import { NOTHING_SPENT, totalSpend, type TurnSpend } from '../turn-spend'

let minted = 0

const rowOf = ({
  threadId,
  steps,
  inputTokens,
}: {
  threadId: ThreadId
  steps: number
  inputTokens: number
}): TurnSpend => {
  minted += 1
  return {
    runId: toRunId(`run-${minted}`),
    threadId,
    status: 'completed',
    providerId: 'anthropic',
    modelId: 'claude-opus-5',
    steps,
    inputTokens,
    outputTokens: 10,
    cacheReadTokens: 20,
    cacheWriteTokens: 30,
    startedAt: '2026-08-26T10:00:00.000Z',
    endedAt: '2026-08-26T10:00:12.000Z',
    durationMs: 12_000,
  }
}

const parent = toThreadId('thread-parent')

describe('totalling turn spend', () => {
  it('counts nothing over no rows', () => {
    expect(totalSpend([])).toEqual(NOTHING_SPENT)
  })

  it('counts a turn per row and sums every token tier', () => {
    const totals = totalSpend([
      rowOf({ threadId: parent, steps: 2, inputTokens: 100 }),
      rowOf({ threadId: parent, steps: 3, inputTokens: 250 }),
    ])

    expect(totals).toEqual({
      turns: 2,
      steps: 5,
      inputTokens: 350,
      outputTokens: 20,
      cacheReadTokens: 40,
      cacheWriteTokens: 60,
    })
  })
})
