import {
  EOperatorRequestOutcome,
  OPERATOR_INPUT_ASKED,
  OPERATOR_INPUT_SETTLED,
} from '@dltech/atlas-plugin-operator/core'
import { describe, expect, it } from 'bun:test'

import { answerRigOf, closedFromAsk, entryOf, parkedFromAsk, REQUEST } from './operator-answer-rig'

const signal = new AbortController().signal

const ask = (rig: ReturnType<typeof answerRigOf>) =>
  rig.input.ask({ ask: { kind: 'input', prompt: 'the login code' }, signal })

describe('an operator request whose parked call closed without an answer', () => {
  it('is settled abandoned when an answer arrives for it', async () => {
    const rig = answerRigOf({ events: closedFromAsk('input') })
    rig.hand({ ok: true, value: 'marked-value-6f2a' })

    const outcome = await rig.intake.handle(entryOf())

    expect(outcome.wakesTurn).toBe(false)
    expect(rig.appended).toMatchObject([
      {
        type: OPERATOR_INPUT_SETTLED,
        requestId: REQUEST,
        outcome: EOperatorRequestOutcome.Abandoned,
      },
    ])
    expect(rig.appended).toHaveLength(1)
    expect(rig.calls).toEqual([])
    expect(rig.settlements).toEqual([
      { requestId: REQUEST, outcome: EOperatorRequestOutcome.Abandoned },
    ])
  })

  it('is settled abandoned when the operator sends a message or stops the session', async () => {
    const rig = answerRigOf({ events: closedFromAsk('input') })

    await rig.intake.cancelOpen({ reason: 'the operator sent a message instead of answering' })

    expect(rig.appended).toMatchObject([
      { type: OPERATOR_INPUT_SETTLED, outcome: EOperatorRequestOutcome.Abandoned },
    ])
    expect(rig.appended).toHaveLength(1)
    expect(rig.settlements).toEqual([
      { requestId: REQUEST, outcome: EOperatorRequestOutcome.Abandoned },
    ])
  })

  it('is settled abandoned before a new ask opens another request', async () => {
    const rig = answerRigOf({ events: closedFromAsk('input') })

    const opened = await ask(rig)

    expect(opened).toEqual({ ok: true, requestId: REQUEST })
    expect(rig.appended).toMatchObject([
      { type: OPERATOR_INPUT_SETTLED, outcome: EOperatorRequestOutcome.Abandoned },
      { type: OPERATOR_INPUT_ASKED, requestId: REQUEST },
    ])
    expect(rig.opens()).toBe(1)
    expect(rig.settlements).toEqual([
      { requestId: REQUEST, outcome: EOperatorRequestOutcome.Abandoned },
    ])
  })

  it('leaves a request alone while its parked call is still open', async () => {
    const rig = answerRigOf({ events: parkedFromAsk('input') })

    await ask(rig)

    expect(rig.appended).toMatchObject([{ type: OPERATOR_INPUT_ASKED }])
    expect(rig.appended).toHaveLength(1)
    expect(rig.settlements).toEqual([])
    expect(rig.log.filter((event) => event.type === 'tool-result')).toHaveLength(0)
  })
})
