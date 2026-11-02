import { describe, expect, it } from 'bun:test'

import {
  checkRunOutcomeOf,
  checksRollup,
  checksTally,
  ECheckOutcome,
  EChecksState,
  latestAttemptOutcomes,
  statusContextOutcomeOf,
} from '../checks'

describe('checksRollup', () => {
  it('is none with nothing to roll up', () => {
    expect(checksRollup([])).toBe(EChecksState.None)
  })

  it('is failing when one failure hides among passes', () => {
    expect(
      checksRollup([
        ECheckOutcome.Passed,
        ECheckOutcome.Passed,
        ECheckOutcome.Failed,
        ECheckOutcome.Passed,
      ]),
    ).toBe(EChecksState.Failing)
  })

  it('is running while a pass and a run coexist', () => {
    expect(checksRollup([ECheckOutcome.Passed, ECheckOutcome.Running])).toBe(EChecksState.Running)
  })

  it('is failing rather than running when both are present', () => {
    expect(checksRollup([ECheckOutcome.Running, ECheckOutcome.Failed])).toBe(EChecksState.Failing)
  })

  it('is none when everything is ignored', () => {
    expect(checksRollup([ECheckOutcome.Ignored, ECheckOutcome.Ignored])).toBe(EChecksState.None)
  })
})

describe('checksTally', () => {
  it('counts each outcome and leaves the ignored ones out', () => {
    expect(
      checksTally([
        ECheckOutcome.Passed,
        ECheckOutcome.Passed,
        ECheckOutcome.Failed,
        ECheckOutcome.Running,
        ECheckOutcome.Ignored,
      ]),
    ).toEqual({ running: 1, passed: 2, failed: 1, ignored: 1 })
  })

  it('is all zeroes with nothing to count', () => {
    expect(checksTally([])).toEqual({ running: 0, passed: 0, failed: 0, ignored: 0 })
  })
})

describe('latestAttemptOutcomes', () => {
  it('drops a cancelled run that a newer same-named run superseded', () => {
    expect(
      latestAttemptOutcomes([
        { name: 'lint', startedAt: '2026-09-03T18:39:58Z', outcome: ECheckOutcome.Failed },
        { name: 'lint', startedAt: '2026-09-03T18:45:10Z', outcome: ECheckOutcome.Passed },
      ]),
    ).toEqual([ECheckOutcome.Passed])
  })

  it('keeps a failure that is still the newest run of its check', () => {
    expect(
      latestAttemptOutcomes([
        { name: 'lint', startedAt: '2026-09-03T18:45:10Z', outcome: ECheckOutcome.Passed },
        { name: 'lint', startedAt: '2026-09-03T18:50:02Z', outcome: ECheckOutcome.Failed },
      ]),
    ).toEqual([ECheckOutcome.Failed])
  })

  it('ranks runs of different names independently', () => {
    expect(
      latestAttemptOutcomes([
        { name: 'lint', startedAt: '2026-09-03T18:39:58Z', outcome: ECheckOutcome.Failed },
        { name: 'lint', startedAt: '2026-09-03T18:45:10Z', outcome: ECheckOutcome.Passed },
        { name: 'build', startedAt: '2026-09-03T18:40:00Z', outcome: ECheckOutcome.Failed },
      ]),
    ).toEqual([ECheckOutcome.Passed, ECheckOutcome.Failed])
  })

  it('keeps an attempt it cannot order, by name or by time, rather than guessing', () => {
    expect(
      latestAttemptOutcomes([
        { name: null, startedAt: '2026-09-03T18:39:58Z', outcome: ECheckOutcome.Failed },
        { name: 'lint', startedAt: null, outcome: ECheckOutcome.Running },
        { name: 'lint', startedAt: '2026-09-03T18:45:10Z', outcome: ECheckOutcome.Passed },
      ]),
    ).toEqual([ECheckOutcome.Failed, ECheckOutcome.Running, ECheckOutcome.Passed])
  })

  it('keeps both attempts of a check when their start times tie', () => {
    expect(
      latestAttemptOutcomes([
        { name: 'lint', startedAt: '2026-09-03T18:45:10Z', outcome: ECheckOutcome.Failed },
        { name: 'lint', startedAt: '2026-09-03T18:45:10Z', outcome: ECheckOutcome.Passed },
      ]),
    ).toEqual([ECheckOutcome.Failed, ECheckOutcome.Passed])
  })
})

describe('checkRunOutcomeOf', () => {
  it('reads REST lowercase and GraphQL uppercase the same way', () => {
    expect(checkRunOutcomeOf({ status: 'completed', conclusion: 'success' })).toBe(
      ECheckOutcome.Passed,
    )
    expect(checkRunOutcomeOf({ status: 'COMPLETED', conclusion: 'SUCCESS' })).toBe(
      ECheckOutcome.Passed,
    )
    expect(checkRunOutcomeOf({ status: 'COMPLETED', conclusion: 'TIMED_OUT' })).toBe(
      ECheckOutcome.Failed,
    )
    expect(checkRunOutcomeOf({ status: 'completed', conclusion: 'cancelled' })).toBe(
      ECheckOutcome.Failed,
    )
  })

  it('ignores skipped, neutral, stale and unknown conclusions', () => {
    for (const conclusion of ['skipped', 'NEUTRAL', 'stale', 'mystery', null]) {
      expect(checkRunOutcomeOf({ status: 'completed', conclusion })).toBe(ECheckOutcome.Ignored)
    }
  })

  it('is running until the run completes', () => {
    expect(checkRunOutcomeOf({ status: 'in_progress', conclusion: null })).toBe(
      ECheckOutcome.Running,
    )
    expect(checkRunOutcomeOf({ status: 'QUEUED', conclusion: null })).toBe(ECheckOutcome.Running)
  })
})

describe('statusContextOutcomeOf', () => {
  it('maps both casings and ignores unknown states', () => {
    expect(statusContextOutcomeOf('success')).toBe(ECheckOutcome.Passed)
    expect(statusContextOutcomeOf('PENDING')).toBe(ECheckOutcome.Running)
    expect(statusContextOutcomeOf('EXPECTED')).toBe(ECheckOutcome.Running)
    expect(statusContextOutcomeOf('error')).toBe(ECheckOutcome.Failed)
    expect(statusContextOutcomeOf('failure')).toBe(ECheckOutcome.Failed)
    expect(statusContextOutcomeOf('weird')).toBe(ECheckOutcome.Ignored)
  })
})
