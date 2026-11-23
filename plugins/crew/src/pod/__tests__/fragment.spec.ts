import { describe, expect, it } from 'bun:test'

import { CrewFragment } from '../fragment'

describe('the crew fragment', () => {
  it('states that a sub-agent in a worktree can commit, push and open a PR, and must report the URL', () => {
    const text = new CrewFragment().text()
    expect(text).toContain('commit on its own branch')
    expect(text).toContain('push it and open a')
    expect(text).toContain('pull request with `gh`')
    expect(text).toContain('must report the URL')
  })

  it('states the group rule, and that a teammate never joins a group', () => {
    const text = new CrewFragment().text()
    expect(text).toContain('they form a group')
    expect(text).toContain('It wakes you one time, when the last one ends')
    expect(text).toContain('A sub-agent that fails, or that the operator')
    expect(text).toContain('stops, wakes you at once and the group stays open')
    expect(text).toContain('A teammate never joins a group')
  })
})
