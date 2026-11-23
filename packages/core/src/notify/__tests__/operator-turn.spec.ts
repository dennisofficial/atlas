import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { EMessageOrigin } from '../../events/body'
import { operatorTurnOf } from '../operator-turn'
import { operatorSaid, turnEnded, turnStarted } from './notify-fixtures'

describe('operatorTurnOf', () => {
  it('counts an operator message inside the turn that just ended', () => {
    const events = [turnStarted(), operatorSaid(), turnEnded()]

    expect(operatorTurnOf({ events })).toBe(true)
  })

  it('ignores an operator message from the turn before', () => {
    const events = [turnStarted(), operatorSaid(), turnEnded(), turnStarted(), turnEnded()]

    expect(operatorTurnOf({ events })).toBe(false)
  })

  it('does not count a parent agent brief', () => {
    const events = [turnStarted(), operatorSaid(EMessageOrigin.ParentAgent), turnEnded()]

    expect(operatorTurnOf({ events })).toBe(false)
  })

  it('does not count a peer agent message', () => {
    const events = [turnStarted(), operatorSaid(EMessageOrigin.PeerAgent), turnEnded()]

    expect(operatorTurnOf({ events })).toBe(false)
  })

  it('counts no message at all as no operator turn', () => {
    const events = [turnStarted(), turnEnded()]

    expect(operatorTurnOf({ events })).toBe(false)
  })

  it('reads the tail when the turn end is not appended yet', () => {
    const events = [turnStarted(), operatorSaid(), turnEnded(), turnStarted(), operatorSaid()]

    expect(operatorTurnOf({ events })).toBe(true)
  })

  it('reads the tail of a log that holds no turn end yet', () => {
    const events = [operatorSaid()]

    expect(operatorTurnOf({ events })).toBe(true)
  })

  it('starts a fresh window at every turn end', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }), (operatorTurns) => {
        const events = operatorTurns.flatMap((operatorTurn) => [
          turnStarted(),
          ...(operatorTurn ? [operatorSaid()] : []),
          turnEnded(),
        ])

        expect(operatorTurnOf({ events })).toBe(operatorTurns.at(-1) ?? false)
      }),
    )
  })
})
