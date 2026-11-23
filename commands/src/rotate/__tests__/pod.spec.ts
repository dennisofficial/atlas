import { describe, expect, it } from 'bun:test'
import { ScriptedModel } from '@dltech/atlas-agent/testing'
import {
  ECompactionAnchor,
  type Event,
  type EventDraft,
  type ModelPort,
  type RecordBody,
} from '@dltech/atlas-core'

import { REFUSAL_ROTATE_CHILDREN } from '../spec'
import {
  REFUSAL_ROTATE_EMPTY,
  REFUSAL_ROTATE_FAILED,
  REFUSAL_ROTATE_NO_MODEL,
  REFUSAL_ROTATE_NOTHING,
  REFUSAL_ROTATE_UNCHANGED,
  rotateHandler,
  rotateNow,
} from '../pod'
import { eventsFrom, replied, said } from '../../rewind/__tests__/fixture'

const rotated = (handoff: string): EventDraft => ({ type: 'rotated', handoff })

const conversation = () => eventsFrom([said('first'), replied('one')])

const run = async ({
  args = {},
  model,
  visibleEvents = conversation,
  runningChildren = 0,
}: {
  args?: unknown
  model?: ModelPort | undefined
  visibleEvents?: () => readonly Event[]
  runningChildren?: number
}) => {
  const appended: (EventDraft | RecordBody)[] = []
  const result = await rotateHandler({
    args,
    sessionId: 's1',
    inboxId: 7,
    model,
    visibleEvents,
    logEvents: () => [],
    append: async (drafts) => {
      appended.push(...drafts)
    },
    runningChildren: () => runningChildren,
    log: () => undefined,
  })
  return { appended, result }
}

const textOf = (model: ScriptedModel): string =>
  JSON.stringify(model.requests[0]?.assembled.messages[0]?.message ?? '')

describe('rotateHandler', () => {
  it('appends exactly one rotated event with the trimmed brief', async () => {
    const model = new ScriptedModel([{ text: '  the brief  ' }])
    const { appended, result } = await run({ model })
    expect(result).toEqual({ kind: 'done' })
    expect(appended).toEqual([{ type: 'rotated', handoff: 'the brief' }])
    expect(model.requests).toHaveLength(1)
    expect(model.requests[0]?.tools).toEqual([])
  })

  it('sends the transcript since the previous boundary', async () => {
    const model = new ScriptedModel([{ text: 'the brief' }])
    const { result } = await run({
      model,
      visibleEvents: () =>
        eventsFrom([
          said('first'),
          replied('one'),
          rotated('the old brief'),
          said('second'),
          replied('two'),
        ]),
    })
    expect(result).toEqual({ kind: 'done' })
    const sent = textOf(model)
    expect(sent).toContain('second')
    expect(sent).toContain('two')
    expect(sent).not.toContain('first')
    expect(sent).not.toContain('old brief')
  })

  it('puts the operator instruction in the request and on the event', async () => {
    const model = new ScriptedModel([{ text: 'the brief' }])
    const { appended, result } = await run({
      model,
      args: { instructions: 'ship the migration first' },
    })
    expect(result).toEqual({ kind: 'done' })
    expect(textOf(model)).toContain('ship the migration first')
    expect(appended).toEqual([
      { type: 'rotated', handoff: 'the brief', instructions: 'ship the migration first' },
    ])
  })

  it('carries the percent when rotateNow runs automatically', async () => {
    const appended: (EventDraft | RecordBody)[] = []
    const result = await rotateNow({
      model: new ScriptedModel([{ text: 'the brief' }]),
      visibleEvents: conversation,
      append: async (drafts) => {
        appended.push(...drafts)
      },
      auto: { percent: 86 },
    })
    expect(result).toEqual({ kind: 'done' })
    expect(appended).toEqual([{ type: 'rotated', handoff: 'the brief', auto: { percent: 86 } }])
  })

  it('refuses a second run with nothing since the last rotation', async () => {
    const model = new ScriptedModel([{ text: 'x' }])
    const { appended, result } = await run({
      model,
      visibleEvents: () => eventsFrom([said('first'), replied('one'), rotated('the brief')]),
    })
    expect(result).toEqual({ kind: 'refused', reason: REFUSAL_ROTATE_UNCHANGED })
    expect(appended).toEqual([])
    expect(model.requests).toHaveLength(0)
  })

  it('refuses a replay where only a compaction marker landed after the boundary', async () => {
    const model = new ScriptedModel([{ text: 'x' }])
    const { appended, result } = await run({
      model,
      visibleEvents: () =>
        eventsFrom([
          said('first'),
          replied('one'),
          rotated('the brief'),
          {
            type: 'history-compacted',
            anchor: ECompactionAnchor.Prefix,
            fromSeq: 1,
            throughSeq: 2,
            summary: 'the old turns',
            replaced: 2,
          },
        ]),
    })
    expect(result).toEqual({ kind: 'refused', reason: REFUSAL_ROTATE_UNCHANGED })
    expect(appended).toEqual([])
    expect(model.requests).toHaveLength(0)
  })

  it('rotates again once the thread has work after the boundary', async () => {
    const model = new ScriptedModel([{ text: 'the brief' }])
    const { appended, result } = await run({
      model,
      visibleEvents: () =>
        eventsFrom([said('first'), replied('one'), rotated('old brief'), said('second')]),
    })
    expect(result).toEqual({ kind: 'done' })
    expect(appended).toHaveLength(1)
  })

  it('refuses a thread without a message', async () => {
    const model = new ScriptedModel([{ text: 'x' }])
    const { appended, result } = await run({
      model,
      visibleEvents: () => eventsFrom([replied('one')]),
    })
    expect(result).toEqual({ kind: 'refused', reason: REFUSAL_ROTATE_NOTHING })
    expect(appended).toEqual([])
    expect(model.requests).toHaveLength(0)
  })

  it('refuses without a model', async () => {
    const { appended, result } = await run({})
    expect(result).toEqual({ kind: 'refused', reason: REFUSAL_ROTATE_NO_MODEL })
    expect(appended).toEqual([])
  })

  it('refuses while a sub-agent runs', async () => {
    const model = new ScriptedModel([{ text: 'x' }])
    const { appended, result } = await run({ model, runningChildren: 1 })
    expect(result).toEqual({ kind: 'refused', reason: REFUSAL_ROTATE_CHILDREN })
    expect(appended).toEqual([])
    expect(model.requests).toHaveLength(0)
  })

  it('refuses an empty handoff', async () => {
    const { appended, result } = await run({ model: new ScriptedModel([{ text: ' ' }]) })
    expect(result).toEqual({ kind: 'refused', reason: REFUSAL_ROTATE_EMPTY })
    expect(appended).toEqual([])
  })

  it('refuses when the model throws', async () => {
    const { appended, result } = await run({
      model: new ScriptedModel([{ throws: new Error('boom') }]),
    })
    expect(result).toEqual({ kind: 'refused', reason: `${REFUSAL_ROTATE_FAILED}: boom` })
    expect(appended).toEqual([])
  })

  it('refuses unparsable args', async () => {
    const { result } = await run({ args: { instructions: 7 } })
    expect(result.kind).toBe('refused')
  })
})
