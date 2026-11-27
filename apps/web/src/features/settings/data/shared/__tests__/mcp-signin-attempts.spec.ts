import { describe, expect, it } from 'bun:test'

import {
  markMcpSignInShown,
  mcpSignInsAwaitingResult,
  rememberMcpSignIn,
} from '../mcp-signin-attempts'

describe('the sign-ins a settings page started', () => {
  it('remembers the server label under its state', () => {
    rememberMcpSignIn({ state: 'a1', label: 'posthog' })

    expect(mcpSignInsAwaitingResult()).toContainEqual({ state: 'a1', label: 'posthog' })
  })

  it('stops reporting a sign-in once its result is shown', () => {
    rememberMcpSignIn({ state: 'b1', label: 'linear' })
    markMcpSignInShown('b1')

    expect(mcpSignInsAwaitingResult().some((attempt) => attempt.state === 'b1')).toBe(false)
  })

  it('ignores a link that names no state, and keeps the latest attempt per state', () => {
    rememberMcpSignIn({ state: '', label: 'nameless' })
    rememberMcpSignIn({ state: 'c1', label: 'old' })
    rememberMcpSignIn({ state: 'c1', label: 'linear' })

    const held = mcpSignInsAwaitingResult().filter((attempt) => attempt.state === 'c1')
    expect(held).toEqual([{ state: 'c1', label: 'linear' }])
    expect(mcpSignInsAwaitingResult().some((attempt) => attempt.state === '')).toBe(false)
  })

  it('forgets the oldest attempt past its limit', () => {
    for (let index = 0; index < 10; index += 1)
      rememberMcpSignIn({ state: `d${index}`, label: 'linear' })

    const states = mcpSignInsAwaitingResult().map((attempt) => attempt.state)
    expect(states).toHaveLength(8)
    expect(states).not.toContain('d0')
    expect(states).toContain('d9')
  })
})
