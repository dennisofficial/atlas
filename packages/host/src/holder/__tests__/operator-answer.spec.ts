import { EOperatorRequestOutcome, OPERATOR_INPUT_SETTLED } from '@dltech/atlas-plugin-operator/core'
import { ECallFailure } from '@dltech/atlas-protocol'
import { describe, expect, it } from 'bun:test'

import { answerRigOf, CALL, entryOf, PATH, REQUEST, VALUE } from './operator-answer-rig'

describe('the operator answer intake', () => {
  it('writes the value to a 0600 file, settles the request and closes the parked call', async () => {
    const rig = answerRigOf()
    rig.hand({ ok: true, value: VALUE })

    const outcome = await rig.intake.handle(entryOf())

    expect(outcome.wakesTurn).toBe(true)
    expect(rig.calls.map((op) => op.op)).toEqual(['mkdir', 'writeFile'])
    const written = rig.calls[1]
    expect(written).toMatchObject({ path: PATH, content: VALUE, mode: 0o600 })
    expect(rig.appended).toMatchObject([
      {
        type: OPERATOR_INPUT_SETTLED,
        requestId: REQUEST,
        outcome: EOperatorRequestOutcome.Delivered,
        path: PATH,
      },
      { type: 'tool-result', callId: CALL, name: 'operator_input' },
    ])
    expect(JSON.stringify(rig.appended)).not.toContain(VALUE)
    expect(rig.settlements).toEqual([
      { requestId: REQUEST, outcome: EOperatorRequestOutcome.Delivered },
    ])
    expect(rig.results).toEqual([{ requestId: REQUEST, result: { ok: true } }])
  })

  it('types the value into the shell instead of a file', async () => {
    const rig = answerRigOf({ kind: 'shell' })
    rig.hand({ ok: true, value: VALUE })

    await rig.intake.handle(entryOf())

    expect(rig.calls.map((op) => op.op)).toEqual(['shells.write'])
    expect(JSON.stringify(rig.appended)).not.toContain(VALUE)
  })

  it('cancels the parked call with a refusal when the operator cancels', async () => {
    const rig = answerRigOf()
    rig.hand({ ok: false, cancel: true })

    const outcome = await rig.intake.handle(entryOf())

    expect(outcome.wakesTurn).toBe(true)
    expect(rig.calls).toEqual([])
    expect(rig.appended).toMatchObject([
      { type: OPERATOR_INPUT_SETTLED, outcome: EOperatorRequestOutcome.Cancelled },
      {
        type: 'tool-result',
        callId: CALL,
        error: { message: expect.stringContaining('cancelled') },
      },
    ])
    expect(rig.settlements).toEqual([
      { requestId: REQUEST, outcome: EOperatorRequestOutcome.Cancelled },
    ])
  })

  it('leaves the request open when the file cannot be written so the operator can retry', async () => {
    const rig = answerRigOf({ failure: { code: ECallFailure.PermissionDenied, op: 'writeFile' } })
    rig.hand({ ok: true, value: VALUE })

    const outcome = await rig.intake.handle(entryOf())

    expect(outcome.wakesTurn).toBe(false)
    expect(rig.appended).toEqual([])
    expect(rig.settlements).toEqual([])
    expect(rig.results[0]?.result).toMatchObject({ ok: false })
  })

  it('settles failed and closes the call when the shell is gone', async () => {
    const rig = answerRigOf({
      kind: 'shell',
      failure: { code: ECallFailure.NotFound, op: 'shells.write' },
    })
    rig.hand({ ok: true, value: VALUE })

    const outcome = await rig.intake.handle(entryOf())

    expect(outcome.wakesTurn).toBe(true)
    expect(rig.appended).toMatchObject([
      { type: OPERATOR_INPUT_SETTLED, outcome: EOperatorRequestOutcome.Failed },
      { type: 'tool-result', callId: CALL },
    ])
    expect(rig.settlements).toEqual([
      { requestId: REQUEST, outcome: EOperatorRequestOutcome.Failed },
    ])
  })

  it('consumes the entry and wakes nothing when the handoff has no value', async () => {
    const rig = answerRigOf()

    const outcome = await rig.intake.handle(entryOf())

    expect(outcome.wakesTurn).toBe(false)
    expect(rig.calls).toEqual([])
    expect(rig.appended).toEqual([])
    expect(rig.settlements).toEqual([])
  })

  it('wakes nothing and settles nothing when the payload is malformed', async () => {
    const rig = answerRigOf()
    rig.hand({ ok: true, value: VALUE })

    const outcome = await rig.intake.handle({ ...entryOf(), payload: '{"requestId":""}' })
    const garbage = await rig.intake.handle({ ...entryOf(), payload: 'not json' })

    expect(outcome.wakesTurn).toBe(false)
    expect(garbage.wakesTurn).toBe(false)
    expect(rig.calls).toEqual([])
    expect(rig.appended).toEqual([])
    expect(rig.settlements).toEqual([])
  })

  it('settles the open request cancelled so a later message leaves no stuck card', async () => {
    const rig = answerRigOf()

    await rig.intake.cancelOpen({ reason: 'the operator sent a message instead of answering' })

    expect(rig.appended).toMatchObject([
      { type: OPERATOR_INPUT_SETTLED, outcome: EOperatorRequestOutcome.Cancelled },
      { type: 'tool-result', callId: CALL },
    ])
    expect(rig.settlements).toEqual([
      { requestId: REQUEST, outcome: EOperatorRequestOutcome.Cancelled },
    ])
    expect(rig.results).toEqual([{ requestId: REQUEST, result: { ok: true } }])
  })
})
