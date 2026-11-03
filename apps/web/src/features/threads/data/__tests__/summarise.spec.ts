import { describe, expect, it } from 'bun:test'

import type { SummariseReach } from '@dltech/atlas-core'
import { EClientRequest } from '@dltech/atlas-client/channel'

import {
  decideSummarise,
  ESummariseDecision,
  NOTHING_TO_SUMMARISE,
  requestSummarise,
  SUMMARISE_ALREADY_RUNNING,
  SUMMARISE_NEEDS_SANDBOX,
  SUMMARISE_WAITS_FOR_TURN,
  summariseCopyOf,
} from '../summarise'

const middle: SummariseReach = { throughSeq: 4, messages: 2 }
const points = new Map([['evt_5', middle]])

const decide = (args: { eventId?: string; live?: boolean; working?: boolean; running?: boolean }) =>
  decideSummarise({
    points,
    eventId: args.eventId ?? 'evt_5',
    live: args.live ?? true,
    working: args.working ?? false,
    running: args.running ?? false,
  })

describe('decideSummarise', () => {
  it('confirms the reach of the picked message', () => {
    expect(decide({})).toEqual({ kind: ESummariseDecision.Confirm, pick: middle })
  })

  it('warns while a summary runs, a turn runs, or the sandbox is away', () => {
    expect(decide({ running: true })).toEqual({
      kind: ESummariseDecision.Warn,
      message: SUMMARISE_ALREADY_RUNNING,
    })
    expect(decide({ working: true })).toEqual({
      kind: ESummariseDecision.Warn,
      message: SUMMARISE_WAITS_FOR_TURN,
    })
    expect(decide({ live: false })).toEqual({
      kind: ESummariseDecision.Warn,
      message: SUMMARISE_NEEDS_SANDBOX,
    })
  })

  it('ignores a message that is not a summarise point', () => {
    expect(decide({ eventId: 'evt_9' })).toEqual({ kind: ESummariseDecision.Ignore })
  })
})

describe('summariseCopyOf', () => {
  it('counts the earlier messages', () => {
    expect(summariseCopyOf(middle).description).toStartWith(
      'The 2 earlier messages and every reply',
    )
  })
})

describe('requestSummarise', () => {
  const run = (reply: unknown) => {
    const sent: { op: EClientRequest; params: unknown }[] = []
    const result = requestSummarise({
      request: async (call) => {
        sent.push(call)
        return reply
      },
      threadId: 'thr_1',
      operationId: 'op_1',
      pick: { throughSeq: 4, messages: 2 },
    })
    return { sent, result }
  }

  it('sends summarise-history with the prefix anchor and the last seq it covers', async () => {
    const { sent, result } = run({ type: 'compacted', replaced: 4, fromSeq: 1, throughSeq: 4 })

    expect(await result).toBe('Summarised 2 messages')
    expect(sent).toEqual([
      {
        op: EClientRequest.SummariseHistory,
        params: { threadId: 'thr_1', operationId: 'op_1', anchor: 'prefix', seq: 4 },
      },
    ])
  })

  it('surfaces a refusal as an error and nothing as a notice', async () => {
    await expect(run({ type: 'refused', reason: 'splits a tool call' }).result).rejects.toThrow(
      'splits a tool call',
    )
    expect(await run({ type: 'nothing' }).result).toBe(NOTHING_TO_SUMMARISE)
  })
})
