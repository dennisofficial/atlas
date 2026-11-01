import { describe, expect, it } from 'bun:test'

import type { Sandbox } from '@vercel/sandbox'

import { renewSessionDeadline } from '../sandbox-sdk.js'

type FakeState = {
  liveSessionId: string
  sessionStatus: string
  expiresAt: number | undefined
  extensions: number[]
}

const fakeSandbox = (state: FakeState): Sandbox => {
  const sandbox: unknown = {
    get expiresAt() {
      return state.expiresAt === undefined ? undefined : new Date(state.expiresAt)
    },
    currentSession: () => ({
      sessionId: state.liveSessionId,
      status: state.sessionStatus,
      startedAt: new Date(500_000),
      extendTimeout: async (delta: number) => {
        state.extensions.push(delta)
        if (state.expiresAt !== undefined) state.expiresAt += delta
      },
    }),
  }
  return sandbox as Sandbox
}

const stateOf = (overrides: Partial<FakeState> = {}): FakeState => ({
  liveSessionId: 'ses_live',
  sessionStatus: 'running',
  expiresAt: 1_000_000,
  extensions: [],
  ...overrides,
})

const renew = (state: FakeState, until: number) =>
  renewSessionDeadline({
    sandbox: fakeSandbox(state),
    name: 'atlas-thread-x',
    sessionId: 'ses_live',
    until,
  })

describe('renewSessionDeadline', () => {
  it('extends the session by the gap to until and observes the new deadline', async () => {
    const state = stateOf()

    expect(await renew(state, 1_600_000)).toEqual({
      sessionId: 'ses_live',
      expiresAt: 1_600_000,
      startedAt: 500_000,
      extendedByMs: 600_000,
    })
    expect(state.extensions).toEqual([600_000])
  })

  it('does not extend a deadline already past until', async () => {
    const state = stateOf()

    expect((await renew(state, 900_000)).extendedByMs).toBe(0)
    expect(state.extensions).toEqual([])
  })

  it('does not extend when the sandbox reports no deadline', async () => {
    const state = stateOf({ expiresAt: undefined })

    expect(await renew(state, 1_600_000)).toMatchObject({
      expiresAt: null,
      extendedByMs: 0,
    })
    expect(state.extensions).toEqual([])
  })

  it('refuses a stale session id', async () => {
    const state = stateOf({ liveSessionId: 'ses_new' })

    await expect(renew(state, 1_600_000)).rejects.toThrow('ses_new')
    expect(state.extensions).toEqual([])
  })

  it('refuses a session that is not running', async () => {
    const state = stateOf({ sessionStatus: 'stopped' })

    await expect(renew(state, 1_600_000)).rejects.toThrow('is stopped')
    expect(state.extensions).toEqual([])
  })
})
