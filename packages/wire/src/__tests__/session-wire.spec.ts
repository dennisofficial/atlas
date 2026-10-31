import { describe, expect, it } from 'bun:test'

import { wireThreadSchema } from '../session-wire'

const thread = {
  id: 'thread',
  head: 0,
  createdAt: '2026-10-31T00:00:00.000Z',
  updatedAt: '2026-10-31T00:00:00.000Z',
  workspace: null,
  repo: 'o/r',
}

const linked = {
  number: 7,
  url: 'https://github.com/o/r/pull/7',
  repo: 'o/r',
  branch: 'fix/sidebar',
}

const metadata = {
  title: 'Fix sidebar',
  state: 'draft',
  checksRunning: 2,
  checksPassed: 3,
  checksFailed: 1,
  mergeable: false,
}

describe('thread pull request metadata', () => {
  it('carries persisted metadata through thread serialization', () => {
    const parsed = wireThreadSchema.parse({
      ...thread,
      pullRequests: [{ ...linked, ...metadata }],
    })
    expect(parsed.pullRequests).toEqual([{ ...linked, ...metadata }])
  })

  it('accepts old links without inventing check counts or mergeability', () => {
    const parsed = wireThreadSchema.parse({ ...thread, pullRequests: [linked] })
    expect(parsed.pullRequests).toEqual([linked])
  })

  it('preserves explicitly unknown mergeability', () => {
    const parsed = wireThreadSchema.parse({
      ...thread,
      pullRequests: [{ ...linked, mergeable: null }],
    })
    expect(parsed.pullRequests?.[0]?.mergeable).toBeNull()
  })

  it.each([-1, 1.5])('rejects invalid check counts: %s', (checksPassed) => {
    expect(
      wireThreadSchema.safeParse({
        ...thread,
        pullRequests: [{ ...linked, checksPassed }],
      }).success,
    ).toBe(false)
  })
})
