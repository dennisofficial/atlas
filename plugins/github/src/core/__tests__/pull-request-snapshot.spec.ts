import { describe, expect, it } from 'bun:test'

import {
  EReviewDecision,
  pullRequestSnapshotOf,
  reviewDecisionOf,
  runSnapshotOf,
} from '../pull-request-snapshot'

const PR = {
  draft: false,
  headSha: 'a1b2c3d4e5f6',
  mergeable: true,
  baseBranch: 'main',
}

const passed = { passed: 3, failed: 0, running: 0, ignored: 0 }
const running = { passed: 2, failed: 0, running: 1, ignored: 0 }
const failing = { passed: 1, failed: 2, running: 0, ignored: 0 }

describe('reviewDecisionOf', () => {
  it('reads the latest review of each reviewer', () => {
    expect(
      reviewDecisionOf([
        { author: 'tofik', state: 'CHANGES_REQUESTED' },
        { author: 'tofik', state: 'APPROVED' },
      ]),
    ).toBe(EReviewDecision.Approved)
  })

  it('puts a change request above an approval', () => {
    expect(
      reviewDecisionOf([
        { author: 'tofik', state: 'APPROVED' },
        { author: 'sam', state: 'CHANGES_REQUESTED' },
      ]),
    ).toBe(EReviewDecision.ChangesRequested)
  })

  it('has no decision without a review', () => {
    expect(reviewDecisionOf([])).toBeUndefined()
    expect(reviewDecisionOf([{ author: 'sam', state: 'COMMENTED' }])).toBeUndefined()
  })
})

describe('pullRequestSnapshotOf', () => {
  it('says no CI notice comes for a head whose checks already passed', () => {
    expect(
      pullRequestSnapshotOf({
        ...PR,
        checks: { tally: passed, failedNames: [] },
        reviews: [{ author: 'tofik', state: 'APPROVED' }],
      }),
    ).toEqual({
      facts: [
        'ready for review, head a1b2c3d',
        'CI finished, all checks passed (3 passed, 0 failed, 0 running)',
        'mergeable',
        'review approved',
      ],
      next: 'No CI notice comes for this head. The next notices are a new push, a comment or review, or a merge or close.',
    })
  })

  it('names the failed checks and the base branch in conflict', () => {
    expect(
      pullRequestSnapshotOf({
        draft: true,
        headSha: 'a1b2c3d4e5f6',
        mergeable: false,
        baseBranch: 'main',
        checks: { tally: failing, failedNames: ['lint', 'test (20)'] },
        reviews: [{ author: 'sam', state: 'CHANGES_REQUESTED' }],
      }),
    ).toEqual({
      facts: [
        'draft, head a1b2c3d',
        'CI finished, 2 checks failed (1 passed, 2 failed, 0 running): lint, test (20)',
        'has merge conflicts with main',
        'review changes requested',
      ],
      next: 'No CI notice comes for this head. The next notices are a new push, a comment or review, or a merge or close.',
    })
  })

  it('promises a CI notice while a check runs', () => {
    expect(pullRequestSnapshotOf({ ...PR, checks: { tally: running, failedNames: [] } })).toEqual({
      facts: [
        'ready for review, head a1b2c3d',
        'CI is still running (2 passed, 0 failed, 1 running)',
        'mergeable',
      ],
      next: 'A CI notice follows when it settles.',
    })
  })

  it('still expects a CI notice when the head has no checks yet, because CI may not have started', () => {
    const snapshot = pullRequestSnapshotOf({
      ...PR,
      checks: { tally: { passed: 0, failed: 0, running: 0, ignored: 0 }, failedNames: [] },
    })
    expect(snapshot.facts).toEqual(['ready for review, head a1b2c3d', 'mergeable'])
    expect(snapshot.next).toBe(
      'No checks are reported for this head yet. If CI starts on it, a CI notice follows when it settles.',
    )
  })

  it('keeps the facts it has when the checks read failed', () => {
    const snapshot = pullRequestSnapshotOf({ ...PR, mergeable: null, headSha: null })
    expect(snapshot.facts).toEqual(['mergeability not known yet'])
    expect(snapshot.next).toBe(
      'CI state is not known now. The next notices are a new push, a comment or review, or a merge or close.',
    )
  })
})

describe('runSnapshotOf', () => {
  it('counts the finished jobs of a run still in progress', () => {
    expect(
      runSnapshotOf([
        { name: 'typecheck', status: 'completed', conclusion: 'success' },
        { name: 'test (20)', status: 'completed', conclusion: 'failure' },
        { name: 'lint', status: 'in_progress', conclusion: null },
      ]),
    ).toEqual({
      facts: ['2 of 3 jobs finished, 1 failed: test (20)'],
      next: 'A notice arrives when the run finishes.',
    })
  })

  it('says when no job has started, and keeps quiet when the jobs read failed', () => {
    expect(runSnapshotOf([]).facts).toEqual(['no jobs have started yet'])
    expect(runSnapshotOf(undefined)).toEqual({
      facts: [],
      next: 'A notice arrives when the run finishes.',
    })
  })
})
