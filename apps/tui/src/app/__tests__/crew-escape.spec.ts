import { describe, expect, test } from 'bun:test'

import { crewEscapeOf, ECrewEscape } from '../use-crew'

describe('the crew escape rule', () => {
  test('does nothing when no sub-agent is open', () => {
    expect(crewEscapeOf({ viewing: null, armed: null, stoppable: true })).toBe(ECrewEscape.Ignore)
  })

  test('walks back from a sub-agent that has ended', () => {
    expect(crewEscapeOf({ viewing: 'a1', armed: null, stoppable: false })).toBe(ECrewEscape.Back)
  })

  test('arms the stop on the first escape of a live sub-agent', () => {
    expect(crewEscapeOf({ viewing: 'a1', armed: null, stoppable: true })).toBe(ECrewEscape.Arm)
    expect(crewEscapeOf({ viewing: 'a1', armed: 'a2', stoppable: true })).toBe(ECrewEscape.Arm)
  })

  test('stops the sub-agent the second escape names', () => {
    expect(crewEscapeOf({ viewing: 'a1', armed: 'a1', stoppable: true })).toBe(ECrewEscape.Stop)
  })
})
