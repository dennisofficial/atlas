import { describe, expect, it } from 'bun:test'

import { initialSessionViewState, SESSION_VIEW_VERSION } from '@dltech/atlas-core'

import { decodeViewState, encodeViewState } from '../src/session-view-codec'
import { usableState } from '../src/session-view-ops'

const STATE = {
  ...initialSessionViewState,
  at: 3,
  failure: { failureHead: null, prepared: true, afterFailure: true },
}

const row = (args: { version: number; state: unknown }) => ({
  sessionId: 'session-1',
  threadId: 'thread-1',
  atSeq: STATE.at,
  version: args.version,
  state: JSON.stringify(args.state),
})

describe('session view codec', () => {
  it('round-trips the failure state', () => {
    expect(decodeViewState(encodeViewState(STATE))).toEqual(STATE)
    expect(usableState(row({ version: SESSION_VIEW_VERSION, state: STATE }))).toEqual(STATE)
  })

  it('rejects a state of the current version that carries no failure state', () => {
    const { failure: _dropped, ...oldShape } = STATE
    expect(decodeViewState(JSON.stringify(oldShape))).toBeUndefined()
    expect(usableState(row({ version: SESSION_VIEW_VERSION, state: oldShape }))).toBeUndefined()
  })

  it('rejects a state of the current version whose facts miss a status fact', () => {
    const { setupRun: _dropped, ...oldFacts } = STATE.facts
    const oldShape = { ...STATE, facts: oldFacts }
    expect(decodeViewState(JSON.stringify(oldShape))).toBeUndefined()
    expect(usableState(row({ version: SESSION_VIEW_VERSION, state: oldShape }))).toBeUndefined()
  })

  it('rejects a row written by an older view version', () => {
    expect(usableState(row({ version: SESSION_VIEW_VERSION - 1, state: STATE }))).toBeUndefined()
  })
})
