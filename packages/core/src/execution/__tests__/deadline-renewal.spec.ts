import { describe, expect, test } from 'bun:test'

import { EDeadlineDecision, deadlineRenewal } from '../deadline-renewal'

const MIN = 60_000
const policy = { graceMs: 30 * MIN, marginMs: 5 * MIN, leadMs: 20 * MIN }

describe('deadlineRenewal', () => {
  test('working with ample headroom holds', () => {
    const decision = deadlineRenewal({
      now: 0,
      expiresAt: 120 * MIN,
      working: true,
      quietSince: undefined,
      policy,
    })
    expect(decision).toEqual({ kind: EDeadlineDecision.Hold, capped: false })
  })

  test('working near the deadline extends past grace plus lead', () => {
    const decision = deadlineRenewal({
      now: 230 * MIN,
      expiresAt: 240 * MIN,
      working: true,
      quietSince: undefined,
      policy,
    })
    expect(decision).toEqual({
      kind: EDeadlineDecision.Extend,
      until: 285 * MIN,
      capped: false,
    })
  })

  test('quiet keeps the full grace after the last work but adds no lead', () => {
    const decision = deadlineRenewal({
      now: 238 * MIN,
      expiresAt: 240 * MIN,
      working: false,
      quietSince: 236 * MIN,
      policy,
    })
    expect(decision).toEqual({
      kind: EDeadlineDecision.Extend,
      until: 271 * MIN,
      capped: false,
    })
  })

  test('quiet long enough that grace fits never extends, so idle park wins', () => {
    const decision = deadlineRenewal({
      now: 200 * MIN,
      expiresAt: 240 * MIN,
      working: false,
      quietSince: 180 * MIN,
      policy,
    })
    expect(decision.kind).toBe(EDeadlineDecision.Hold)
  })

  test('quiet with an unknown origin treats now as the origin', () => {
    const decision = deadlineRenewal({
      now: 239 * MIN,
      expiresAt: 240 * MIN,
      working: false,
      quietSince: undefined,
      policy,
    })
    expect(decision).toEqual({
      kind: EDeadlineDecision.Extend,
      until: 274 * MIN,
      capped: false,
    })
  })

  test('an unknown deadline extends', () => {
    const decision = deadlineRenewal({
      now: 0,
      expiresAt: undefined,
      working: true,
      quietSince: undefined,
      policy,
    })
    expect(decision.kind).toBe(EDeadlineDecision.Extend)
  })

  test('the hard limit clamps the extension and reports capped', () => {
    const decision = deadlineRenewal({
      now: 1_420 * MIN,
      expiresAt: 1_430 * MIN,
      working: true,
      quietSince: undefined,
      hardLimitAt: 1_440 * MIN,
      policy,
    })
    expect(decision).toEqual({
      kind: EDeadlineDecision.Extend,
      until: 1_440 * MIN,
      capped: true,
    })
  })

  test('at the hard limit it holds and stays capped', () => {
    const decision = deadlineRenewal({
      now: 1_430 * MIN,
      expiresAt: 1_440 * MIN,
      working: true,
      quietSince: undefined,
      hardLimitAt: 1_440 * MIN,
      policy,
    })
    expect(decision).toEqual({ kind: EDeadlineDecision.Hold, capped: true })
  })
})
