import { EOperatorRequestOutcome } from '@dltech/atlas-plugin-operator/core'
import { ECallFailure } from '@dltech/atlas-protocol'
import { describe, expect, it } from 'bun:test'

import {
  answerRigOf,
  CALL,
  entryOf,
  inputRequest,
  OTHER,
  PATH,
  SESSION,
  VALUE,
} from './operator-answer-rig'

describe('the operator answer intake', () => {
  it('writes the value to a 0600 file and closes the parked call with one result', async () => {
    const rig = answerRigOf()
    rig.hand({ ok: true, value: VALUE })

    const outcome = await rig.intake.handle(entryOf())

    expect(outcome.wakesTurn).toBe(true)
    expect(rig.calls.map((op) => op.op)).toEqual(['mkdir', 'writeFile'])
    expect(rig.calls[1]).toMatchObject({ path: PATH, content: VALUE, mode: 0o600 })
    expect(rig.appended).toHaveLength(1)
    expect(rig.appended[0]).toMatchObject({
      type: 'tool-result',
      callId: CALL,
      name: 'operator_input',
      output: { outcome: EOperatorRequestOutcome.Delivered, path: PATH },
    })
    expect(JSON.stringify(rig.appended)).not.toContain(VALUE)
    expect(rig.results).toEqual([
      { key: { sessionId: SESSION, callId: CALL }, result: { ok: true } },
    ])
  })

  it('types the value into the shell instead of a file', async () => {
    const rig = answerRigOf({ kind: 'shell' })
    rig.hand({ ok: true, value: VALUE })

    await rig.intake.handle(entryOf())

    expect(rig.calls.map((op) => op.op)).toEqual(['shells.write'])
    expect(rig.appended[0]).toMatchObject({
      output: { outcome: EOperatorRequestOutcome.Delivered, bytes: VALUE.length },
    })
    expect(JSON.stringify(rig.appended)).not.toContain(VALUE)
  })

  it('closes the call cancelled when the operator cancels', async () => {
    const rig = answerRigOf()
    rig.hand({ ok: false, cancel: true })

    const outcome = await rig.intake.handle(entryOf())

    expect(outcome.wakesTurn).toBe(true)
    expect(rig.calls).toEqual([])
    expect(rig.appended).toMatchObject([
      {
        type: 'tool-result',
        callId: CALL,
        output: { outcome: EOperatorRequestOutcome.Cancelled },
        error: { message: expect.stringContaining('cancelled') },
      },
    ])
  })

  it('appends nothing and leaves the call open when the file cannot be written', async () => {
    const rig = answerRigOf({ failure: { code: ECallFailure.PermissionDenied, op: 'writeFile' } })
    rig.hand({ ok: true, value: VALUE })

    const outcome = await rig.intake.handle(entryOf())

    expect(outcome.wakesTurn).toBe(false)
    expect(rig.appended).toEqual([])
    expect(rig.results[0]?.result).toMatchObject({ ok: false })
  })

  it('closes the call failed when the shell is gone', async () => {
    const rig = answerRigOf({
      kind: 'shell',
      failure: { code: ECallFailure.NotFound, op: 'shells.write' },
    })
    rig.hand({ ok: true, value: VALUE })

    const outcome = await rig.intake.handle(entryOf())

    expect(outcome.wakesTurn).toBe(true)
    expect(rig.appended).toMatchObject([
      {
        type: 'tool-result',
        callId: CALL,
        output: { outcome: EOperatorRequestOutcome.Failed },
        error: { message: expect.stringContaining('shl_1') },
      },
    ])
  })

  it('wakes nothing when the handoff holds no value', async () => {
    const rig = answerRigOf()

    const outcome = await rig.intake.handle(entryOf())

    expect(outcome.wakesTurn).toBe(false)
    expect(rig.calls).toEqual([])
    expect(rig.appended).toEqual([])
  })

  it('wakes nothing and resolves nothing when the payload is malformed', async () => {
    const rig = answerRigOf()
    rig.hand({ ok: true, value: VALUE })

    const empty = await rig.intake.handle({ ...entryOf(), payload: '{"callId":""}' })
    const garbage = await rig.intake.handle({ ...entryOf(), payload: 'not json' })

    expect(empty.wakesTurn).toBe(false)
    expect(garbage.wakesTurn).toBe(false)
    expect(rig.calls).toEqual([])
    expect(rig.appended).toEqual([])
  })

  it('answers each of two parked calls with its own result', async () => {
    const rig = answerRigOf()
    await rig.park(OTHER, inputRequest)

    rig.hand({ ok: true, value: VALUE })
    await rig.intake.handle(entryOf(CALL))

    expect(rig.appended).toHaveLength(1)
    expect(rig.appended[0]).toMatchObject({ type: 'tool-result', callId: CALL })

    rig.hand({ ok: true, value: 'second-value' })
    await rig.intake.handle(entryOf(OTHER))

    expect(rig.appended).toHaveLength(2)
    expect(rig.appended[1]).toMatchObject({ type: 'tool-result', callId: OTHER })
    expect(rig.calls.map((op) => op.op)).toEqual(['mkdir', 'writeFile', 'mkdir', 'writeFile'])
  })

  it('refuses an answer for a parked call that carried no request', async () => {
    const rig = answerRigOf({ drafts: [] })
    await rig.park(CALL, undefined)
    rig.hand({ ok: true, value: VALUE })

    const outcome = await rig.intake.handle(entryOf())

    expect(outcome.wakesTurn).toBe(false)
    expect(rig.appended).toEqual([])
    expect(rig.results[0]?.result).toEqual({
      ok: false,
      reason: 'the request is no longer open',
    })
  })

  it('closes every open operator call on a message, legacy ones included', async () => {
    const rig = answerRigOf({ drafts: [] })
    await rig.park(CALL, inputRequest)
    await rig.park(OTHER, undefined)

    await rig.intake.cancelOpen({ reason: 'the operator sent a message instead of answering' })

    expect(rig.appended).toMatchObject([
      { type: 'tool-result', callId: CALL, error: { message: expect.stringContaining('message') } },
      {
        type: 'tool-result',
        callId: OTHER,
        error: { message: expect.stringContaining('message') },
      },
    ])
    expect(rig.results).toHaveLength(2)
  })
})
