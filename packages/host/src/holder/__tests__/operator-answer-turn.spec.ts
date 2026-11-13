import {
  loopStateOf,
  openParkedCallsOf,
  pendingCallsOf,
  settleablePendingOf,
} from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { answerRigOf, CALL, entryOf, VALUE } from './operator-answer-rig'

describe('a turn that parks on an operator request and is answered', () => {
  it('closes the call once, leaves the parked set empty and never re-runs the tool', async () => {
    const rig = answerRigOf()
    expect(openParkedCallsOf(rig.events()).map((open) => open.callId)).toEqual([CALL])

    rig.hand({ ok: true, value: VALUE })
    const answered = await rig.intake.handle(entryOf())
    const repeated = await rig.intake.handle(entryOf())

    expect(answered.wakesTurn).toBe(true)
    expect(repeated.wakesTurn).toBe(false)
    expect(rig.appended).toHaveLength(1)

    const state = loopStateOf({ events: rig.events() })
    expect(pendingCallsOf(state)).toEqual([])
    expect(settleablePendingOf(state)).toEqual([])
    expect(state.parked.size).toBe(0)
    expect(openParkedCallsOf(rig.events())).toEqual([])
    expect(rig.draftLog.filter((draft) => draft.type === 'tool-called')).toHaveLength(1)
    expect(JSON.stringify(rig.draftLog)).not.toContain(VALUE)
  })
})
