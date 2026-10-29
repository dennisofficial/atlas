import { describe, expect, it } from 'bun:test'

import { EThreadStatus, threadStatusOf } from '../thread-status'
import { threadOf } from './fixtures'

const pr = (number: number, state?: string) => ({
  number,
  url: `https://github.com/x/y/pull/${number}`,
  repo: 'x/y',
  branch: `b${number}`,
  ...(state === undefined ? {} : { state }),
})

describe('threadStatusOf', () => {
  it('is idle without pull requests', () => {
    expect(threadStatusOf(threadOf({ id: 'a' }))).toBe(EThreadStatus.Idle)
    expect(threadStatusOf(threadOf({ id: 'a', pullRequests: [] }))).toBe(EThreadStatus.Idle)
  })

  it('is PR open for an open pull request or one with no recorded state', () => {
    expect(threadStatusOf(threadOf({ id: 'a', pullRequests: [pr(1, 'open')] }))).toBe(
      EThreadStatus.PrOpen,
    )
    expect(threadStatusOf(threadOf({ id: 'a', pullRequests: [pr(1)] }))).toBe(EThreadStatus.PrOpen)
  })

  it('is PR open when an open pull request sits beside a merged one', () => {
    expect(
      threadStatusOf(
        threadOf({
          id: 'a',
          pullRequests: [pr(1467, 'merged'), pr(1469, 'open')],
        }),
      ),
    ).toBe(EThreadStatus.PrOpen)
    expect(
      threadStatusOf(threadOf({ id: 'a', pullRequests: [pr(1, 'open'), pr(2, 'merged')] })),
    ).toBe(EThreadStatus.PrOpen)
  })

  it('is PR merged when merged is the only non-closed state', () => {
    expect(
      threadStatusOf(threadOf({ id: 'a', pullRequests: [pr(1, 'closed'), pr(2, 'merged')] })),
    ).toBe(EThreadStatus.PrMerged)
  })

  it('is idle when every pull request is closed', () => {
    expect(threadStatusOf(threadOf({ id: 'a', pullRequests: [pr(1, 'closed')] }))).toBe(
      EThreadStatus.Idle,
    )
  })
})
