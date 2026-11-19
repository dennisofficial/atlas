import { describe, expect, it } from 'bun:test'
import { ECheckOutcome, EChecksState } from '../checks'
import {
  checksSummaryOfStored,
  EStoredChecksState,
  missingRequiredContextsOf,
  storedChecksStateOf,
} from '../pr-checks-state'

describe('storedChecksStateOf', () => {
  it('reads a required context nobody reported as expected', () => {
    expect(storedChecksStateOf({ outcomes: [], missingRequiredContexts: ['ci'] })).toBe(
      EStoredChecksState.Expected,
    )
    expect(
      storedChecksStateOf({
        outcomes: [ECheckOutcome.Passed],
        missingRequiredContexts: ['ci'],
      }),
    ).toBe(EStoredChecksState.Expected)
  })

  it('reads the settled tally once every required context reports', () => {
    expect(
      storedChecksStateOf({
        outcomes: [ECheckOutcome.Passed, ECheckOutcome.Ignored],
        missingRequiredContexts: [],
      }),
    ).toBe(EStoredChecksState.Success)
    expect(
      storedChecksStateOf({
        outcomes: [ECheckOutcome.Passed, ECheckOutcome.Failed],
        missingRequiredContexts: [],
      }),
    ).toBe(EStoredChecksState.Failure)
    expect(
      storedChecksStateOf({
        outcomes: [ECheckOutcome.Running],
        missingRequiredContexts: [],
      }),
    ).toBe(EStoredChecksState.Pending)
  })

  it('lets a red or running check outrank a required context still to report', () => {
    expect(
      storedChecksStateOf({
        outcomes: [ECheckOutcome.Failed],
        missingRequiredContexts: ['ci'],
      }),
    ).toBe(EStoredChecksState.Failure)
    expect(
      storedChecksStateOf({
        outcomes: [ECheckOutcome.Running],
        missingRequiredContexts: ['ci'],
      }),
    ).toBe(EStoredChecksState.Pending)
  })

  it('stores nothing for a head with no checks and no required contexts', () => {
    expect(storedChecksStateOf({ outcomes: [], missingRequiredContexts: [] })).toBeNull()
  })
})

describe('missingRequiredContextsOf', () => {
  it('lists only the required contexts the head has not reported', () => {
    expect(
      missingRequiredContextsOf({
        requiredContexts: ['ci', 'Vercel – atlas-storybook'],
        reportedContexts: ['ci', 'build'],
      }),
    ).toEqual(['Vercel – atlas-storybook'])
  })

  it('needs no contexts to be missing', () => {
    expect(missingRequiredContextsOf({ requiredContexts: [], reportedContexts: ['ci'] })).toEqual(
      [],
    )
  })
})

describe('checksSummaryOfStored', () => {
  const counts = { running: 0, passed: 0, failed: 0, ignored: 0 }

  it('reads an expected header as no checks when nothing has reported', () => {
    expect(
      checksSummaryOfStored({
        checksState: EStoredChecksState.Expected,
        counts,
        headSha: 'abc123',
      }),
    ).toBeNull()
  })

  it('rebuilds a partially reported head from its counts', () => {
    expect(
      checksSummaryOfStored({
        checksState: EStoredChecksState.Expected,
        counts: { ...counts, passed: 2 },
        headSha: 'abc123',
      }),
    ).toEqual({
      headSha: 'abc123',
      running: 0,
      passed: 2,
      failed: 0,
      ignored: 0,
      rollup: EChecksState.Passing,
    })
  })

  it('keeps the none rollup of a head whose checks were all ignored', () => {
    expect(
      checksSummaryOfStored({
        checksState: EStoredChecksState.Success,
        counts: { ...counts, ignored: 3 },
        headSha: 'abc123',
      }),
    ).toEqual({
      headSha: 'abc123',
      running: 0,
      passed: 0,
      failed: 0,
      ignored: 3,
      rollup: EChecksState.None,
    })
  })
})
