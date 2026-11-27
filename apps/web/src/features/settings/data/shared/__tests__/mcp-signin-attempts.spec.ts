import { describe, expect, it } from 'bun:test'

import {
  markMcpSignInShown,
  mcpSignInsAwaitingResult,
  rememberMcpSignIn,
} from '../mcp-signin-attempts'

const OWNER = 'project:proj-a'

describe('the sign-ins a settings page started', () => {
  it('keeps each page to the sign-ins it started', () => {
    rememberMcpSignIn({ state: 'e1', label: 'posthog', owner: 'project:proj-b' })

    expect(mcpSignInsAwaitingResult(OWNER).some((attempt) => attempt.state === 'e1')).toBe(false)
    expect(mcpSignInsAwaitingResult('project:proj-b').map((attempt) => attempt.state)).toContain(
      'e1',
    )
  })

  it('remembers the server label under its state', () => {
    rememberMcpSignIn({ state: 'a1', label: 'posthog', owner: OWNER })

    expect(mcpSignInsAwaitingResult(OWNER)).toContainEqual({
      state: 'a1',
      label: 'posthog',
      owner: OWNER,
    })
  })

  it('stops reporting a sign-in once its result is shown', () => {
    rememberMcpSignIn({ state: 'b1', label: 'linear', owner: OWNER })
    markMcpSignInShown('b1')

    expect(mcpSignInsAwaitingResult(OWNER).some((attempt) => attempt.state === 'b1')).toBe(false)
  })

  it('ignores a link that names no state, and keeps the latest attempt per state', () => {
    rememberMcpSignIn({ state: '', label: 'nameless', owner: OWNER })
    rememberMcpSignIn({ state: 'c1', label: 'old', owner: OWNER })
    rememberMcpSignIn({ state: 'c1', label: 'linear', owner: OWNER })

    const held = mcpSignInsAwaitingResult(OWNER).filter((attempt) => attempt.state === 'c1')
    expect(held).toEqual([{ state: 'c1', label: 'linear', owner: OWNER }])
    expect(mcpSignInsAwaitingResult(OWNER).some((attempt) => attempt.state === '')).toBe(false)
  })

  it('forgets the oldest attempt past its limit', () => {
    for (let index = 0; index < 10; index += 1)
      rememberMcpSignIn({ state: `d${index}`, label: 'linear', owner: OWNER })

    const states = mcpSignInsAwaitingResult(OWNER).map((attempt) => attempt.state)
    expect(states).toHaveLength(8)
    expect(states).not.toContain('d0')
    expect(states).toContain('d9')
  })
})
