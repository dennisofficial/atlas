import { describe, expect, it } from 'bun:test'

import { ESessionStatus } from '@dltech/atlas-core'
import { ESessionConnection, type SessionSnapshot } from '@dltech/atlas-client/stream'

import { EHeaderState } from '@/features/threads/data/header-model'

import { headerStateOfSession, isSessionWorking, sessionStateLineOf } from '../session-state'

const LEASE = { epoch: 1, holderHostId: 1, live: true }

const snapshotOf = (params: {
  state?: ESessionStatus | undefined
  reason?: string
  connection?: ESessionConnection
}): Pick<SessionSnapshot, 'status' | 'connection'> => ({
  status:
    params.state === undefined
      ? undefined
      : {
          state: params.state,
          lease: LEASE,
          ...(params.reason === undefined ? {} : { reason: params.reason }),
        },
  connection: params.connection ?? ESessionConnection.Live,
})

describe('isSessionWorking', () => {
  it('is true while the agent is busy', () => {
    for (const state of [
      ESessionStatus.Preparing,
      ESessionStatus.Sent,
      ESessionStatus.Thinking,
      ESessionStatus.RunningTool,
      ESessionStatus.WaitingToRetry,
      ESessionStatus.Resuming,
    ]) {
      expect(isSessionWorking(snapshotOf({ state }).status)).toBe(true)
    }
  })

  it('is false when idle, failed, blocked or unknown', () => {
    for (const state of [
      ESessionStatus.Idle,
      ESessionStatus.Failed,
      ESessionStatus.SetupFailed,
      ESessionStatus.WaitingForCredentials,
      undefined,
    ]) {
      expect(isSessionWorking(snapshotOf({ state }).status)).toBe(false)
    }
  })
})

describe('sessionStateLineOf', () => {
  it('says nothing when live and healthy', () => {
    expect(sessionStateLineOf(snapshotOf({ state: ESessionStatus.Thinking }))).toBeNull()
  })

  it('names the connection while it is not live', () => {
    expect(sessionStateLineOf(snapshotOf({ connection: ESessionConnection.CatchingUp }))).toBe(
      'Catching up…',
    )
    expect(sessionStateLineOf(snapshotOf({ connection: ESessionConnection.Reconnecting }))).toBe(
      'Reconnecting…',
    )
    expect(sessionStateLineOf(snapshotOf({ connection: ESessionConnection.Offline }))).toBe(
      'Offline — reload to reconnect',
    )
  })

  it('gives the setup failure with its reason', () => {
    expect(
      sessionStateLineOf(snapshotOf({ state: ESessionStatus.SetupFailed, reason: 'clone failed' })),
    ).toBe('Setup failed: clone failed')
    expect(sessionStateLineOf(snapshotOf({ state: ESessionStatus.SetupFailed }))).toBe(
      'Setup failed',
    )
  })

  it('asks for credentials', () => {
    expect(sessionStateLineOf(snapshotOf({ state: ESessionStatus.WaitingForCredentials }))).toBe(
      'Waiting for model credentials',
    )
  })

  it('puts a session problem ahead of the connection', () => {
    expect(
      sessionStateLineOf(
        snapshotOf({
          state: ESessionStatus.SetupFailed,
          reason: 'x',
          connection: ESessionConnection.Reconnecting,
        }),
      ),
    ).toBe('Setup failed: x')
  })
})

describe('headerStateOfSession', () => {
  it('maps the status onto the header badge', () => {
    expect(headerStateOfSession(snapshotOf({ state: ESessionStatus.Thinking }).status)).toBe(
      EHeaderState.Running,
    )
    expect(headerStateOfSession(snapshotOf({ state: ESessionStatus.Failed }).status)).toBe(
      EHeaderState.Failed,
    )
    expect(headerStateOfSession(snapshotOf({ state: ESessionStatus.SetupFailed }).status)).toBe(
      EHeaderState.Failed,
    )
    expect(
      headerStateOfSession(snapshotOf({ state: ESessionStatus.WaitingForCredentials }).status),
    ).toBe(EHeaderState.NeedsYou)
    expect(headerStateOfSession(snapshotOf({ state: ESessionStatus.Idle }).status)).toBe(
      EHeaderState.Idle,
    )
    expect(headerStateOfSession(undefined)).toBe(EHeaderState.Idle)
  })
})
