import { describe, expect, it } from 'bun:test'

import { EChecksState, EPullRequestState, pullRequestBadge, type PullRequest } from '@dltech/atlas-harness'

import { justifySpans } from '../../../ui/components/sidebar/cells'
import type { SidebarRowSplit } from '../../../ui/sidebar-section'
import { theme } from '../../../ui/theme'
import { pullRequestStatusColor } from '../pull-request-pill'
import { pullRequestRow } from '../pull-request-row'

const WIDE = 200

const NOW = 0

const withChecks = (tally: {
  running: number
  passed: number
  failed: number
}): PullRequest => ({
  number: 12,
  state: EPullRequestState.Open,
  url: 'https://github.com/o/r/pull/12',
  title: 'a change',
  checks: tally.failed > 0 ? EChecksState.Failing : EChecksState.None,
  tally,
})

const splitAt = (args: { pullRequest: PullRequest; cells: number }): SidebarRowSplit =>
  pullRequestRow({ pullRequest: args.pullRequest, now: NOW })(args.cells)

const textOf = (spans: readonly { text: string }[]): string =>
  spans.map((span) => span.text).join('')

const textAt = (args: { pullRequest: PullRequest; cells: number }): string => {
  const split = splitAt(args)
  return textOf(justifySpans({ left: split.left, right: split.right, cells: args.cells }))
}

describe('the pull request row gives up richness before it gives up the failure count', () => {
  const pullRequest = withChecks({ running: 2, passed: 3, failed: 1 })

  it('shows everything when the column is wide, number and state left, checks right', () => {
    const split = splitAt({ pullRequest, cells: WIDE })

    expect(textOf(split.left)).toBe('#12 open')
    expect(textOf(split.right)).toContain('2 running')
    expect(textOf(split.right)).toContain('3 ✓')
    expect(textOf(split.right)).toContain('1 ✗')
  })

  it('justifies the number to the left edge and the checks to the right edge', () => {
    const text = textAt({ pullRequest, cells: 30 })

    expect(text.startsWith('#12')).toBe(true)
    expect(text.endsWith('1 ✗')).toBe(true)
    expect(text.length).toBe(30)
  })

  it('drops the state before anything else', () => {
    const text = textAt({ pullRequest, cells: 26 })

    expect(text).not.toContain('open')
    expect(text).toContain('1 ✗')
  })

  it('keeps the number on the left and the failure count on the right', () => {
    const split = splitAt({ pullRequest, cells: 10 })

    expect(textOf(split.left)).toBe('#12')
    expect(textOf(split.right)).toBe('1 ✗')
  })

  it('never clips the failure count away while the number still fits', () => {
    for (let cells = 8; cells <= 40; cells += 1) {
      const text = textAt({ pullRequest, cells })
      if (text.includes('#12') && text.length > '#12'.length) {
        expect(text).toContain('1 ✗')
      }
    }
  })

  it('falls back to the number alone rather than emitting nothing', () => {
    const split = splitAt({ pullRequest, cells: 1 })

    expect(textOf(split.left)).toBe('#12')
    expect(split.right).toEqual([])
  })

  it('says nothing about checks that do not exist', () => {
    const clean = withChecks({ running: 0, passed: 0, failed: 0 })
    const split = splitAt({ pullRequest: clean, cells: WIDE })

    expect(textOf(split.left)).toBe('#12 open')
    expect(split.right).toEqual([])
  })
})

describe('the pull request row inks the number with the shared status color', () => {
  const numberInk = (pullRequest: PullRequest): string | undefined =>
    pullRequestRow({ pullRequest, now: NOW })(WIDE).left.at(0)?.fg

  it('matches the tone the footer chip fills with', () => {
    const failing = withChecks({ running: 0, passed: 1, failed: 1 })

    expect(numberInk(failing)).toBe(pullRequestStatusColor(pullRequestBadge(failing)))
    expect(numberInk(failing)).toBe(theme.error)
  })

  it('reads a merged pull request as merged even when its checks failed', () => {
    const merged: PullRequest = {
      ...withChecks({ running: 0, passed: 1, failed: 1 }),
      state: EPullRequestState.Merged,
      checks: EChecksState.Failing,
    }

    expect(numberInk(merged)).toBe(theme.court.external)
  })

  it('reads an open pull request with no checks as the link blue, not green', () => {
    expect(numberInk(withChecks({ running: 0, passed: 0, failed: 0 }))).toBe(theme.link)
  })

  it('holds the ink at the narrowest rung', () => {
    const failing = withChecks({ running: 0, passed: 1, failed: 1 })

    expect(pullRequestRow({ pullRequest: failing, now: NOW })(1).left.at(0)?.fg).toBe(theme.error)
  })
})
