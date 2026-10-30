import { describe, expect, it } from 'bun:test'

import { ERuntimePhase, runtimeCheckpointSchema, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import { ECloudSandboxState, type CloudSandboxStatus } from '../../cloud/cloud-bridge'
import { EConnectionView } from '../../cloud/connection-view'
import type { ChannelConnection } from '../../cloud/remote-delta-channel'
import { createPodSession, POD_WAKE_FAILED_NOTICE_KEY, type PodSession } from '../pod-session'
import { fakeSessionChannel, POD_THREAD, type FakeSessionChannel } from './fake-session-channel'
import { recordingNotices, type RecordingNotices } from './pod-fakes'

const tick = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

const PARKED: ChannelConnection = { state: EConnectionView.Parked, detail: null }

const checkpointAt = (phase: ERuntimePhase): RuntimeCheckpoint =>
  runtimeCheckpointSchema.parse({
    threadId: POD_THREAD,
    runtimeId: 'runtime-1',
    sandboxSessionId: 'session-a',
    revision: 2,
    phase,
    reportedAt: '2026-10-01T00:00:00.000Z',
    transcript: { head: 10, count: 10, digest: 'a'.repeat(64) },
  })

type Rig = {
  channel: FakeSessionChannel
  session: PodSession
  wakes: () => number
  notices: RecordingNotices
}

const sessionOn = (
  args: {
    find?: (() => Promise<CloudSandboxStatus | undefined>) | undefined
    wake?: (() => Promise<void>) | undefined
    connection?: ChannelConnection | undefined
  } = {},
): Rig => {
  const channel = fakeSessionChannel({ connection: args.connection ?? PARKED })
  const notices = recordingNotices()
  let wakes = 0
  const session = createPodSession({
    channel,
    sandboxes: { find: args.find ?? (async () => undefined) },
    wake: () => {
      wakes += 1
      return args.wake?.() ?? new Promise<void>(() => undefined)
    },
    notice: notices,
    onReload: async () => undefined,
  })
  return { channel, session, wakes: () => wakes, notices }
}

describe('settling a render-first open', () => {
  it('leaves a sandbox the record says is parked asleep until the first send', async () => {
    const parked = checkpointAt(ERuntimePhase.Parked)
    const { channel, session, wakes } = sessionOn({
      find: async () => ({ state: ECloudSandboxState.Parked, checkpoint: parked }),
    })

    session.settleOpen()
    await tick()

    expect(wakes()).toBe(0)
    expect(channel.observed).toEqual([parked])
    expect(session.health().view.state).toBe(EConnectionView.Parked)
  })

  it('wakes a sandbox the record says is serving, showing Waking while it runs', async () => {
    const serving = checkpointAt(ERuntimePhase.Serving)
    const { channel, session, wakes } = sessionOn({
      find: async () => ({ state: ECloudSandboxState.Running, checkpoint: serving }),
    })

    session.settleOpen()
    await tick()

    expect(channel.observed).toEqual([serving])
    expect(wakes()).toBe(1)
    expect(session.health().view.state).toBe(EConnectionView.Waking)
  })

  it('wakes when the provider has no record at all', async () => {
    const { session, wakes } = sessionOn({ find: async () => undefined })

    session.settleOpen()
    await tick()

    expect(wakes()).toBe(1)
  })

  it('wakes when the status read itself fails', async () => {
    const { session, wakes } = sessionOn({
      find: async () => {
        throw new Error('Atlas Cloud could not be reached')
      },
    })

    session.settleOpen()
    await tick()

    expect(wakes()).toBe(1)
  })

  it('settles once, however often it is asked', async () => {
    let finds = 0
    const { session, wakes } = sessionOn({
      find: async () => {
        finds += 1
        return undefined
      },
    })

    session.settleOpen()
    session.settleOpen()
    await tick()

    expect(finds).toBe(1)
    expect(wakes()).toBe(1)
  })
})

describe('the quiet background wake', () => {
  it('joins a wake already in flight instead of claiming the sandbox twice', async () => {
    const { session, wakes } = sessionOn()

    session.wake()
    session.wake()
    await tick()

    expect(wakes()).toBe(1)
  })

  it('wakes again once the previous wake has finished', async () => {
    const { channel, session, wakes } = sessionOn({ wake: async () => undefined })

    session.wake()
    await tick()
    channel.moveTo(PARKED)
    session.wake()
    await tick()

    expect(wakes()).toBe(2)
  })

  it('dials a sandbox the record says is waking when this client holds no attachment yet', async () => {
    const { session, wakes } = sessionOn({
      connection: { state: EConnectionView.Waking, detail: null },
    })

    session.wake()
    await tick()

    expect(wakes()).toBe(1)
  })

  it('leaves a dial already in flight alone while waking or updating', async () => {
    for (const state of [EConnectionView.Waking, EConnectionView.Updating]) {
      const { channel, session, wakes } = sessionOn({ connection: { state, detail: null } })
      channel.attachment = () => ({ url: 'https://sandbox.test', token: 'token' })

      session.wake()
      await tick()

      expect(wakes()).toBe(0)
    }
  })

  it('does nothing against a connected socket', async () => {
    const { session, wakes } = sessionOn({
      connection: { state: EConnectionView.Connected, detail: null },
    })

    session.wake()
    await tick()

    expect(wakes()).toBe(0)
  })

  it('reads Disconnected with the reason and posts one non-sticky notice when it fails', async () => {
    const { session, notices } = sessionOn({
      wake: async () => {
        throw new Error('the sandbox would not start')
      },
    })

    session.wake()
    await tick()

    expect(session.health().view.state).toBe(EConnectionView.Disconnected)
    expect(session.health().view.detail).toContain('the sandbox would not start')
    expect(notices.posted.map((notice) => notice.key)).toEqual([POD_WAKE_FAILED_NOTICE_KEY])
    expect(notices.posted[0]?.ttlMs).not.toBeNull()
  })

  it('posts nothing after the session closed under it', async () => {
    let fail: (error: unknown) => void = () => undefined
    const { session, notices } = sessionOn({
      wake: () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject
        }),
    })

    session.wake()
    session.close()
    fail(new Error('too late'))
    await tick()

    expect(notices.posted).toEqual([])
  })
})

describe('a park', () => {
  it('never produces a notice', async () => {
    const { channel, notices } = sessionOn({
      connection: { state: EConnectionView.Connected, detail: null },
    })

    channel.pushCheckpoint(checkpointAt(ERuntimePhase.Parked))
    channel.moveTo(PARKED)
    await tick()

    expect(notices.posted).toEqual([])
  })
})
