import { describe, expect, test } from 'bun:test'

import {
  checksLabelOf,
  othersOf,
  pinnedOf,
  pullRequestsOf,
  toggleWatched,
} from '../pull-request-model'

describe('pullRequestsOf', () => {
  test('returns the requested count, oldest first, clamped to 0..4', () => {
    expect(pullRequestsOf(0)).toHaveLength(0)
    expect(pullRequestsOf(99)).toHaveLength(4)
    expect(pullRequestsOf(-1)).toHaveLength(0)
    expect(pullRequestsOf(4).map((pr) => pr.number)).toEqual([1460, 1467, 1469, 1472])
  })

  test('always keeps the current pull request when any are shown', () => {
    expect(pullRequestsOf(1).map((pr) => pr.number)).toEqual([1469])
  })
})

describe('pinnedOf and othersOf', () => {
  test('pin the current pull request and list the rest', () => {
    const prs = pullRequestsOf(3)
    expect(pinnedOf(prs)?.number).toBe(1469)
    expect(othersOf(prs).map((pr) => pr.number)).toEqual([1467, 1472])
    expect(pinnedOf([])).toBeUndefined()
  })
})

describe('toggleWatched', () => {
  test('flips only the named pull request', () => {
    const prs = pullRequestsOf(4)
    const next = toggleWatched({ prs, number: 1472 })
    expect(next.find((pr) => pr.number === 1472)?.watched).toBe(true)
    expect(next.find((pr) => pr.number === 1469)?.watched).toBe(true)
    expect(prs.find((pr) => pr.number === 1472)?.watched).toBe(false)
  })
})

describe('checksLabelOf', () => {
  test('prefers failing, then running', () => {
    const byNumber = (n: number) => pullRequestsOf(4).find((pr) => pr.number === n)
    expect(checksLabelOf(byNumber(1472)!)).toBe('1 failing')
    expect(checksLabelOf(byNumber(1469)!)).toBe('3 running')
    expect(checksLabelOf(byNumber(1460)!)).toBeUndefined()
  })
})
