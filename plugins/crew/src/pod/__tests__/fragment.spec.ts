import { describe, expect, it } from 'bun:test'

import { CrewFragment } from '../fragment'

describe('the crew fragment', () => {
  it('states that a child in a worktree may commit, push and open a PR, and must report the URL', () => {
    const text = new CrewFragment().text()
    expect(text).toContain('commit on its own branch')
    expect(text).toContain('push it and open a')
    expect(text).toContain('pull request with `gh`')
    expect(text).toContain('must report the URL')
  })
})
