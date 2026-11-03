import { describe, expect, it } from 'bun:test'

import { ECompactionAnchor, type SummarisePoint } from '@dltech/atlas-core'
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

const middle: SummarisePoint = {
  upTo: { anchor: ECompactionAnchor.Prefix, seq: 4, messages: 2 },
  from: { anchor: ECompactionAnchor.Suffix, seq: 5, messages: 3 },
}
const points = new Map([['evt_5', middle]])

const decide = (args: {
  eventId?: string
  anchor?: ECompactionAnchor
  live?: boolean
  working?: boolean
  running?: boolean
}) =>
  decideSummarise({
    points,
    eventId: args.eventId ?? 'evt_5',
    anchor: args.anchor ?? ECompactionAnchor.Prefix,
    live: args.live ?? true,
    working: args.working ?? false,
    running: args.running ?? false,
  })

describe('decideSummarise', () => {
  it('confirms the reach for the picked direction', () => {
    expect(decide({ anchor: ECompactionAnchor.Suffix })).toEqual({
      kind: ESummariseDecision.Confirm,
      pick: middle.from as NonNullable<SummarisePoint['from']>,
    })
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
  it('counts the earlier messages for up-to and the later ones for from-here', () => {
    expect(
      summariseCopyOf(middle.upTo as NonNullable<SummarisePoint['upTo']>).description,
    ).toStartWith('The 2 earlier messages and every reply')
    expect(
      summariseCopyOf(middle.from as NonNullable<SummarisePoint['from']>).description,
    ).toStartWith('This message, 2 later messages and every reply')
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
      pick: { anchor: ECompactionAnchor.Suffix, seq: 5, messages: 3 },
    })
    return { sent, result }
  }

  it('sends summarise-history with the wire anchor and seq', async () => {
    const { sent, result } = run({ type: 'compacted', replaced: 9, fromSeq: 5, throughSeq: 13 })

    expect(await result).toBe('Summarised 3 messages')
    expect(sent).toEqual([
      {
        op: EClientRequest.SummariseHistory,
        params: { threadId: 'thr_1', operationId: 'op_1', anchor: 'suffix', seq: 5 },
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
