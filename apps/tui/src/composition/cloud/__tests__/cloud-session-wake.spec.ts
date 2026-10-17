import { beforeEach, describe, expect, it } from 'bun:test'

import {
  EConnectionView,
  ECloudSandboxState,
  ERuntimePhase,
  type ChannelConnection,
  type CloudSandboxStatus,
} from '@dltech/atlas-harness'
import { runtimeCheckpointSchema, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import { currentNotices, dismissNotice } from '../../../ui/notice-store'
import { CLOUD_WAKE_FAILED_NOTICE_KEY, createCloudSession, type CloudSession } from '../cloud-session'
import { CLOUD_THREAD, fakeCloudChannel, type FakeCloudChannel } from './fixture'

beforeEach(() => {
  dismissNotice()
})

const tick = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

const PARKED: ChannelConnection = { state: EConnectionView.Parked, detail: null }

const checkpointAt = (phase: ERuntimePhase): RuntimeCheckpoint =>
  runtimeCheckpointSchema.parse({
    threadId: CLOUD_THREAD,
    runtimeId: 'runtime-1',
    sandboxSessionId: 'session-a',
    revision: 2,
    phase,
    reportedAt: '2026-10-01T00:00:00.000Z',
    transcript: { head: 10, count: 10, digest: 'a'.repeat(64) },
  })

type Rig = { channel: FakeCloudChannel; session: CloudSession; wakes: () => number }

const sessionOn = (
  args: {
    find?: (() => Promise<CloudSandboxStatus | undefined>) | undefined
    wake?: (() => Promise<void>) | undefined
    connection?: ChannelConnection | undefined
  } = {},
): Rig => {
  const channel = fakeCloudChannel({ connection: args.connection ?? PARKED })
  let wakes = 0
  const session = createCloudSession({
    channel,
    sandboxes: {
      create: async () => ({ url: '', token: '', state: ECloudSandboxState.Running, created: false }),
      find: args.find ?? (async () => undefined),
      readResources: async () => ({}),
      updateResources: async () => {},
      destroy: async () => undefined,
    },
    wake: () => {
      wakes += 1
      return args.wake?.() ?? new Promise<void>(() => undefined)
    },
    onReload: async () => undefined,
  })
  return { channel, session, wakes: () => wakes }
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
    const { session, wakes } = sessionOn({ connection: { state: EConnectionView.Waking, detail: null } })

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
    const { session, wakes } = sessionOn({ connection: { state: EConnectionView.Connected, detail: null } })

    session.wake()
    await tick()

    expect(wakes()).toBe(0)
  })

  it('reads Disconnected with the reason and posts one non-sticky notice when it fails', async () => {
    const { session } = sessionOn({
      wake: async () => {
        throw new Error('the sandbox would not start')
      },
    })

    session.wake()
    await tick()

    expect(session.health().view.state).toBe(EConnectionView.Disconnected)
    expect(session.health().view.detail).toContain('the sandbox would not start')
    const notices = currentNotices()
    expect(notices.map((notice) => notice.key)).toEqual([CLOUD_WAKE_FAILED_NOTICE_KEY])
    expect(notices[0]?.ttlMs).not.toBeNull()
  })

  it('posts nothing after the session closed under it', async () => {
    let fail: (error: unknown) => void = () => undefined
    const { session } = sessionOn({
      wake: () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject
        }),
    })

    session.wake()
    session.close()
    fail(new Error('too late'))
    await tick()

    expect(currentNotices()).toEqual([])
  })
})

describe('a park', () => {
  it('never produces a notice', async () => {
    const { channel } = sessionOn({ connection: { state: EConnectionView.Connected, detail: null } })

    channel.pushCheckpoint(checkpointAt(ERuntimePhase.Parked))
    channel.moveTo(PARKED)
    await tick()

    expect(currentNotices()).toEqual([])
  })
})
