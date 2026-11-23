import { describe, expect, it } from 'bun:test'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import {
  ECompactionAnchor,
  SUMMARY_REFUSAL_CANNOT,
  SUMMARY_REFUSAL_NOTHING,
  type Event,
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
  visibleEvents = conversation,
}: {
  throughSeq?: number | undefined
  model?: ModelPort | undefined
  visibleEvents?: () => readonly Event[]
}) => {
  const appended: (EventDraft | RecordBody)[] = []
  const result = await summariseHandler({
    args: throughSeq === undefined ? {} : { throughSeq },
    sessionId: 's1',
    inboxId: 7,
    model,
    visibleEvents,
    logEvents: () => [],
    runningChildren: () => 0,
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
        inboxId: 7,
      },
    ])
    const request = model.requests[0]
    expect(request?.tools).toEqual([])
    expect(request?.assembled.messages).toHaveLength(1)
    expect(JSON.stringify(request?.assembled.messages[0]?.message)).toContain('Operator: first')
    expect(JSON.stringify(request?.assembled.messages[0]?.message)).not.toContain('second')
  })

  it('defaults to everything before the last message', async () => {
    const model = new ScriptedModel([{ text: 'the notes' }])
    const { appended, result } = await run({ model })
    expect(result).toEqual({ kind: 'done' })
    expect(appended).toEqual([
      {
        type: 'history-summarised',
        fromSeq: 1,
        throughSeq: 2,
        anchor: ECompactionAnchor.Prefix,
        summary: 'the notes',
        inboxId: 7,
      },
    ])
    expect(JSON.stringify(model.requests[0]?.assembled.messages[0]?.message)).not.toContain(
      'second',
    )
  })

  it('refuses the default with no message of its own', async () => {
    const model = new ScriptedModel([{ text: 'the notes' }])
    const { appended, result } = await run({
      model,
      visibleEvents: () => eventsFrom([replied('one')]),
    })
    expect(result).toEqual({ kind: 'refused', reason: SUMMARY_REFUSAL_NOTHING })
    expect(appended).toEqual([])
    expect(model.requests).toHaveLength(0)
  })

  it('refuses the default when nothing comes before the first message', async () => {
    const model = new ScriptedModel([{ text: 'the notes' }])
    const { appended, result } = await run({
      model,
      visibleEvents: () => eventsFrom([said('only'), replied('one')]),
    })
    expect(result).toEqual({ kind: 'refused', reason: SUMMARY_REFUSAL_NOTHING })
    expect(appended).toEqual([])
    expect(model.requests).toHaveLength(0)
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
      inboxId: 7,
      visibleEvents: conversation,
      logEvents: () => [],
      runningChildren: () => 0,
      append: async () => undefined,
      log: () => undefined,
    })
    expect(result.kind).toBe('refused')
  })
})
