import { describe, expect, it } from 'bun:test'

import { wireThreadSchema } from '../index'

const base = {
  id: 'brn_1',
  head: 3,
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt: '2026-09-15T00:00:00.000Z',
  workspace: null,
  repo: null,
}

describe('the thread wire state fields', () => {
  it('still parses a thread that carries none of them', () => {
    const thread = wireThreadSchema.parse(base)

    expect(thread.pinnedAt).toBeUndefined()
    expect(thread.archivedAt).toBeUndefined()
  })

  it('carries pinnedAt and archivedAt as ISO strings or null', () => {
    const pinned = wireThreadSchema.parse({
      ...base,
      pinnedAt: '2026-09-16T10:00:00.000Z',
      archivedAt: null,
    })

    expect(pinned.pinnedAt).toBe('2026-09-16T10:00:00.000Z')
    expect(pinned.archivedAt).toBeNull()
  })

  it('carries an optional state on a linked pull request', () => {
    const pr = { number: 7, url: 'https://github.com/x/y/pull/7', repo: 'x/y', branch: 'b' }
    const thread = wireThreadSchema.parse({
      ...base,
      pullRequests: [pr, { ...pr, number: 8, state: 'merged' }],
    })

    expect(thread.pullRequests?.map((linked) => linked.state)).toEqual([undefined, 'merged'])
  })

  it('refuses a non-string pinnedAt', () => {
    expect(wireThreadSchema.safeParse({ ...base, pinnedAt: 5 }).success).toBe(false)
  })
})
