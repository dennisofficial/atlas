import { describe, expect, it } from 'bun:test'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import {
  ECompactionAnchor,
  SUMMARY_REFUSAL_CANNOT,
  type EventDraft,
  type ModelPort,
  type RecordBody,
} from '@dltech/atlas-core'

import {
  REFUSAL_EMPTY_SUMMARY,
  REFUSAL_NO_MODEL,
  REFUSAL_SUMMARY_FAILED,
  summariseHandler,
} from '../pod'
import { eventsFrom, replied, said } from '../../rewind/__tests__/fixture'

const conversation = () =>
  eventsFrom([said('first'), replied('one'), said('second'), replied('two')])

const run = async ({
  throughSeq,
  model,
}: {
  throughSeq: number
  model?: ModelPort | undefined
}) => {
  const appended: (EventDraft | RecordBody)[] = []
  const result = await summariseHandler({
    args: { throughSeq },
    sessionId: 's1',
    model,
    visibleEvents: conversation,
    append: async (drafts) => {
      appended.push(...drafts)
    },
    log: () => undefined,
  })
  return { appended, result }
}

describe('summariseHandler', () => {
  it('appends the model text as a prefix summary and sends the range as one user message', async () => {
    const model = new ScriptedModel([{ text: '  the notes  ' }])
    const { appended, result } = await run({ throughSeq: 2, model })
    expect(result).toEqual({ kind: 'done' })
    expect(appended).toEqual([
      {
        type: 'history-summarised',
        fromSeq: 1,
        throughSeq: 2,
        anchor: ECompactionAnchor.Prefix,
        summary: 'the notes',
      },
    ])
    const request = model.requests[0]
    expect(request?.tools).toEqual([])
    expect(request?.assembled.messages).toHaveLength(1)
    expect(JSON.stringify(request?.assembled.messages[0]?.message)).toContain('Operator: first')
    expect(JSON.stringify(request?.assembled.messages[0]?.message)).not.toContain('second')
  })

  it('refuses without a model', async () => {
    const { appended, result } = await run({ throughSeq: 2 })
    expect(result).toEqual({ kind: 'refused', reason: REFUSAL_NO_MODEL })
    expect(appended).toEqual([])
  })

  it('refuses a guard failure without calling the model', async () => {
    const model = new ScriptedModel([{ text: 'x' }])
    const { appended, result } = await run({ throughSeq: 1, model })
    expect(result).toEqual({ kind: 'refused', reason: SUMMARY_REFUSAL_CANNOT })
    expect(appended).toEqual([])
    expect(model.requests).toHaveLength(0)
  })

  it('refuses an empty answer', async () => {
    const { appended, result } = await run({
      throughSeq: 2,
      model: new ScriptedModel([{ text: ' ' }]),
    })
    expect(result).toEqual({ kind: 'refused', reason: REFUSAL_EMPTY_SUMMARY })
    expect(appended).toEqual([])
  })

  it('refuses when the model throws', async () => {
    const model = new ScriptedModel([{ throws: new Error('boom') }])
    const { result } = await run({ throughSeq: 2, model })
    expect(result).toEqual({ kind: 'refused', reason: `${REFUSAL_SUMMARY_FAILED}: boom` })
  })

  it('refuses unparsable args', async () => {
    const result = await summariseHandler({
      args: { throughSeq: 'x' },
      sessionId: 's1',
      visibleEvents: conversation,
      append: async () => undefined,
      log: () => undefined,
    })
    expect(result.kind).toBe('refused')
  })
})
