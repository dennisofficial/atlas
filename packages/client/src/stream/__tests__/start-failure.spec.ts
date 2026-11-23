import { describe, expect, it } from 'bun:test'

import { ESessionStatus } from '@dltech/atlas-core'

import type { SessionSnapshot } from '../session-follower'
import { startFailureOf } from '../session-state'

const statusOf = (args: {
  state: ESessionStatus
  reason?: string
}): NonNullable<SessionSnapshot['status']> => ({
  state: args.state,
  lease: { epoch: 1, holderHostId: null, live: true },
  ...(args.reason === undefined ? {} : { reason: args.reason }),
})

describe('startFailureOf', () => {
  it('reports the reason a session failed to start', () => {
    expect(
      startFailureOf(statusOf({ state: ESessionStatus.StartFailed, reason: 'no credentials' })),
    ).toEqual({ reason: 'no credentials' })
  })

  it('reports a start failure that carries no reason', () => {
    expect(startFailureOf(statusOf({ state: ESessionStatus.StartFailed }))).toEqual({
      reason: undefined,
    })
  })

  it('says nothing for any other status', () => {
    expect(
      startFailureOf(statusOf({ state: ESessionStatus.Failed, reason: 'boom' })),
    ).toBeUndefined()
    expect(startFailureOf(statusOf({ state: ESessionStatus.SetupFailed }))).toBeUndefined()
    expect(startFailureOf(statusOf({ state: ESessionStatus.Idle }))).toBeUndefined()
  })

  it('says nothing while the status is unknown', () => {
    expect(startFailureOf(undefined)).toBeUndefined()
  })
})
