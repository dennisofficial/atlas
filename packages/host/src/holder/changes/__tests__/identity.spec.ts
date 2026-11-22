import { describe, expect, it } from 'bun:test'

import { changeCheckoutId } from '../identity'

const REPO = 'github.com/org/repo'
const WORKTREE = '/atlas/workspaces/repo'

describe('changeCheckoutId', () => {
  it('gives two sessions of one project two ids for the same worktree path', () => {
    const first = changeCheckoutId({ sessionId: 'session-a', repo: REPO, worktreePath: WORKTREE })
    const second = changeCheckoutId({ sessionId: 'session-b', repo: REPO, worktreePath: WORKTREE })
    expect(first).not.toBe(second)
  })

  it('keeps the id stable for the same session, repo and worktree', () => {
    const args = { sessionId: 'session-a', repo: REPO, worktreePath: WORKTREE }
    expect(changeCheckoutId(args)).toBe(changeCheckoutId({ ...args }))
  })
})
