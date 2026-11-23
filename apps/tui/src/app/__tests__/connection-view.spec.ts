import { describe, expect, test } from 'bun:test'

import { ESandboxStatus, type SessionStatusOutput } from '@dltech/atlas-protocol'
import { ESessionConnection } from '@dltech/atlas-client/stream'

import { connectionViewOf } from '../connection-view'

const statusOf = (sandbox: ESandboxStatus | null): SessionStatusOutput =>
  ({
    state: 'idle',
    lease: { epoch: 1, holderHostId: null, live: false },
    ...(sandbox === null ? {} : { sandbox: { status: sandbox, at: '2026-11-20T00:00:00.000Z' } }),
  }) as unknown as SessionStatusOutput

describe('connectionViewOf', () => {
  test('live and catching-up are both connected; catching-up is stale', () => {
    expect(connectionViewOf({ connection: ESessionConnection.Live, status: undefined })).toEqual({
      cloudConnected: true,
      reconnecting: false,
      disconnected: false,
      waking: false,
      stale: false,
    })
    expect(
      connectionViewOf({ connection: ESessionConnection.CatchingUp, status: undefined }),
    ).toEqual({
      cloudConnected: true,
      reconnecting: false,
      disconnected: false,
      waking: false,
      stale: true,
    })
  })

  test('reconnecting and offline each name their own state', () => {
    const reconnecting = connectionViewOf({
      connection: ESessionConnection.Reconnecting,
      status: undefined,
    })
    expect(reconnecting.cloudConnected).toBe(false)
    expect(reconnecting.reconnecting).toBe(true)
    expect(reconnecting.disconnected).toBe(false)

    const offline = connectionViewOf({ connection: ESessionConnection.Offline, status: undefined })
    expect(offline.disconnected).toBe(true)
    expect(offline.reconnecting).toBe(false)
  })

  test('a sleeping or waking sandbox is waking', () => {
    expect(
      connectionViewOf({
        connection: ESessionConnection.Reconnecting,
        status: statusOf(ESandboxStatus.Sleeping),
      }).waking,
    ).toBe(true)
    expect(
      connectionViewOf({
        connection: ESessionConnection.Reconnecting,
        status: statusOf(ESandboxStatus.Waking),
      }).waking,
    ).toBe(true)
  })

  test('a running sandbox and a session with no status are not waking', () => {
    expect(
      connectionViewOf({
        connection: ESessionConnection.Live,
        status: statusOf(ESandboxStatus.Running),
      }).waking,
    ).toBe(false)
    expect(
      connectionViewOf({ connection: ESessionConnection.Live, status: undefined }).waking,
    ).toBe(false)
  })
})
