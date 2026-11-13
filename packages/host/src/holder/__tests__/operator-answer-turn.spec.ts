import { EOperatorRequestOutcome, OPERATOR_INPUT_SETTLED } from '@dltech/atlas-plugin-operator/core'
import { loopStateOf, pendingCallsOf, settleablePendingOf, type Event } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { answerRigOf, CALL, entryOf, PATH, VALUE } from './operator-answer-rig'

const signal = new AbortController().signal

describe('a turn that parks on an operator request and is answered', () => {
  it('writes the value, closes the call once and never re-runs the tool', async () => {
    const rig = answerRigOf({ events: [] })
    const opened = await rig.input.ask({
      ask: { kind: 'input', prompt: 'the login code' },
      signal,
    })
    expect(opened).toEqual({ ok: true, requestId: 'oreq_1' })
    await rig.appendToLog([
      { type: 'tool-called', callId: CALL, name: 'operator_input', input: {} },
      { type: 'tool-dispatched', callId: CALL, name: 'operator_input' },
      { type: 'tool-parked', callId: CALL, name: 'operator_input' },
    ])

    rig.hand({ ok: true, value: VALUE })
    const answered = await rig.intake.handle(entryOf())
    const repeated = await rig.intake.handle(entryOf())

    expect(answered.wakesTurn).toBe(true)
    expect(repeated.wakesTurn).toBe(false)
    expect(rig.calls.map((op) => op.op)).toEqual(['mkdir', 'writeFile'])
    expect(rig.calls[1]).toMatchObject({ path: PATH, content: VALUE, mode: 0o600 })
    const closing = rig.appended.slice(1)
    expect(closing).toMatchObject([
      {
        type: OPERATOR_INPUT_SETTLED,
        outcome: EOperatorRequestOutcome.Delivered,
        path: PATH,
      },
      { type: 'tool-result', callId: CALL, name: 'operator_input' },
    ])
    expect(closing).toHaveLength(2)
    expect(JSON.stringify(rig.log)).not.toContain(VALUE)

    const state = loopStateOf({ events: rig.log as unknown as Event[] })
    expect(pendingCallsOf(state)).toEqual([])
    expect(settleablePendingOf(state)).toEqual([])
    expect(state.parked.size).toBe(0)
    expect(rig.log.filter((event) => event.type === 'tool-called')).toHaveLength(1)
    expect(rig.opens()).toBe(1)
  })
})
