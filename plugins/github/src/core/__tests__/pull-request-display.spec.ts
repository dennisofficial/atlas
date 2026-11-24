import { describe, expect, it } from 'bun:test'

import {
  EChecksSummary,
  EPullRequestGlyph,
  EPullRequestStateWord,
  EPullRequestTone,
  isChecksTally,
  pullRequestChecksTallyOf,
  pullRequestDisplayOf,
  pullRequestHasConflicts,
  pullRequestIsSettled,
  type PullRequestFacts,
} from '../pull-request-display'

const factsOf = (overrides: Partial<PullRequestFacts> = {}): PullRequestFacts => ({
  state: 'open',
  ...overrides,
})

const checks = ({ running = 0, passed = 0, failed = 0, expected = 0 }) => ({
  running,
  passed,
  failed,
  expected,
})

describe('pullRequestDisplayOf glyph and tone', () => {
  it('opens with the open glyph and tone', () => {
    const display = pullRequestDisplayOf(factsOf())
    expect(display.glyph).toBe(EPullRequestGlyph.Open)
    expect(display.tone).toBe(EPullRequestTone.Open)
    expect(display.stateWord).toBe(EPullRequestStateWord.Open)
  })

  it('draws a draft muted, as the web does', () => {
    const display = pullRequestDisplayOf(factsOf({ state: 'draft' }))
    expect(display.glyph).toBe(EPullRequestGlyph.Draft)
    expect(display.tone).toBe(EPullRequestTone.Draft)
  })

  it('draws a merged pull request with the merge glyph and its own tone', () => {
    const display = pullRequestDisplayOf(factsOf({ state: 'merged' }))
    expect(display.glyph).toBe(EPullRequestGlyph.Merged)
    expect(display.tone).toBe(EPullRequestTone.Merged)
    expect(display.settled).toBe(true)
  })

  it('draws a closed pull request with the closed glyph and its own tone', () => {
    const display = pullRequestDisplayOf(factsOf({ state: 'closed' }))
    expect(display.glyph).toBe(EPullRequestGlyph.Closed)
    expect(display.tone).toBe(EPullRequestTone.Closed)
    expect(display.settled).toBe(true)
  })

  it('keeps the open glyph and the muted tone when the state is unknown', () => {
    const display = pullRequestDisplayOf(factsOf({ state: null }))
    expect(display.glyph).toBe(EPullRequestGlyph.Open)
    expect(display.tone).toBe(EPullRequestTone.Unknown)
    expect(display.stateWord).toBe(EPullRequestStateWord.Unknown)
    expect(display.settled).toBe(false)
  })

  it('turns the glyph queued rather than drawing a marker', () => {
    const display = pullRequestDisplayOf(factsOf({ mergeQueued: true, autoMerge: true }))
    expect(display.tone).toBe(EPullRequestTone.Queued)
    expect(display.stateWord).toBe(EPullRequestStateWord.Queued)
    expect(display.autoMerge).toBe(false)
  })

  it('ignores a queue flag on a settled pull request', () => {
    const display = pullRequestDisplayOf(factsOf({ state: 'merged', mergeQueued: true }))
    expect(display.tone).toBe(EPullRequestTone.Merged)
  })

  it('reads the state whatever its case', () => {
    expect(pullRequestDisplayOf(factsOf({ state: 'MERGED' })).glyph).toBe(EPullRequestGlyph.Merged)
  })
})

describe('conflicts', () => {
  it('reports a conflict on an unmergeable open or draft pull request', () => {
    expect(pullRequestHasConflicts(factsOf({ mergeable: false }))).toBe(true)
    expect(pullRequestHasConflicts(factsOf({ state: 'draft', mergeable: false }))).toBe(true)
  })

  it('reports no conflict when mergeable is unknown, true, or the pull request is settled', () => {
    expect(pullRequestHasConflicts(factsOf({ mergeable: null }))).toBe(false)
    expect(pullRequestHasConflicts(factsOf({ mergeable: true }))).toBe(false)
    expect(pullRequestHasConflicts(factsOf({ state: 'merged', mergeable: false }))).toBe(false)
  })
})

describe('auto-merge marker', () => {
  it('shows while the pull request waits open', () => {
    expect(pullRequestDisplayOf(factsOf({ autoMerge: true })).autoMerge).toBe(true)
  })

  it('hides once merged, closed or queued', () => {
    expect(pullRequestDisplayOf(factsOf({ state: 'merged', autoMerge: true })).autoMerge).toBe(
      false,
    )
    expect(pullRequestDisplayOf(factsOf({ state: 'closed', autoMerge: true })).autoMerge).toBe(
      false,
    )
    expect(pullRequestDisplayOf(factsOf({ mergeQueued: true, autoMerge: true })).autoMerge).toBe(
      false,
    )
  })
})

describe('checks', () => {
  it('reads the tally once every count is known', () => {
    const display = pullRequestDisplayOf(
      factsOf({ checks: checks({ running: 1, passed: 2, failed: 3, expected: 4 }) }),
    )
    expect(display.checks).toEqual({ running: 1, passed: 2, failed: 3, expected: 4 })
    expect(isChecksTally(display.checks)).toBe(true)
  })

  it('says no checks when every count is known and zero', () => {
    expect(pullRequestDisplayOf(factsOf({ checks: checks({}) })).checks).toBe(EChecksSummary.None)
  })

  it('says checks unknown before any count arrives', () => {
    expect(pullRequestDisplayOf(factsOf({ checks: null })).checks).toBe(EChecksSummary.Unknown)
  })

  it('says checks unknown while only some counts are known', () => {
    expect(pullRequestDisplayOf(factsOf({ checks: { running: 1 } })).checks).toBe(
      EChecksSummary.Unknown,
    )
    expect(pullRequestChecksTallyOf(factsOf({ checks: { running: 1 } }))).toEqual({
      running: 1,
      passed: 0,
      failed: 0,
      expected: 0,
    })
  })

  it('waits on one expected check when GitHub reports the expected state', () => {
    expect(pullRequestChecksTallyOf(factsOf({ checksState: 'expected' }))).toEqual({
      running: 0,
      passed: 0,
      failed: 0,
      expected: 1,
    })
  })

  it('prefers the given expected count over the expected state', () => {
    expect(
      pullRequestChecksTallyOf(factsOf({ checksState: 'expected', checks: checks({ passed: 2 }) })),
    ).toEqual({ running: 0, passed: 2, failed: 0, expected: 0 })
  })

  it('reports no tally when nothing runs, passes, fails or waits', () => {
    expect(pullRequestChecksTallyOf(factsOf({ checksState: 'success' }))).toBeUndefined()
  })
})

describe('pullRequestIsSettled', () => {
  it('settles only a merged or closed pull request', () => {
    expect(pullRequestIsSettled(factsOf({ state: 'merged' }))).toBe(true)
    expect(pullRequestIsSettled(factsOf({ state: 'closed' }))).toBe(true)
    expect(pullRequestIsSettled(factsOf({ state: 'open' }))).toBe(false)
    expect(pullRequestIsSettled(factsOf({ state: undefined }))).toBe(false)
  })
})
