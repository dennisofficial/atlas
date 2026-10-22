import { describe, expect, it } from 'bun:test'

import { toRunId } from '@dltech/atlas-core'
import {
  EConnectionView,
  ECloudSandboxState,
  EResizeApplies,
  ETurnStatus,
  type ChannelConnection,
  type CloudReload,
} from '@dltech/atlas-harness'

import { createCloudSession, type CloudSession } from '../cloud-session'
import { fakeCloudChannel, type FakeCloudChannel } from './fixture'

const tick = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

type Deferred = { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void }

const deferred = (): Deferred => {
  let resolve: () => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const CONNECTED: ChannelConnection = { state: EConnectionView.Connected, detail: null }

const sessionOn = (
  args: {
    connection?: ChannelConnection | undefined
    onReload?: ((reload: CloudReload) => Promise<void>) | undefined
    appliedAt?: number | undefined
    settleMs?: number | undefined
  } = {},
): { channel: FakeCloudChannel; session: CloudSession; reloads: CloudReload[] } => {
  const channel = fakeCloudChannel({ connection: args.connection ?? CONNECTED })
  const reloads: CloudReload[] = []
  const session = createCloudSession({
    channel,
    sandboxes: {
      create: async () => ({ url: '', token: '', state: ECloudSandboxState.Running, created: false }),
      find: async () => undefined,
      readResources: async () => ({}),
      updateResources: async () => ({ appliesAt: EResizeApplies.Live }),
      destroy: async () => undefined,
    },
    wake: async () => undefined,
    onReload: args.onReload ?? (async (reload) => {
      reloads.push(reload)
    }),
    ...(args.appliedAt === undefined ? {} : { appliedSnapshot: () => ({ appliedAt: args.appliedAt ?? 0 }) }),
    ...(args.settleMs === undefined ? {} : { settleMs: args.settleMs }),
  })
  return { channel, session, reloads }
}

describe('the connection view a cloud session reports', () => {
  it('is the channel view, followed through every move', () => {
    const { channel, session } = sessionOn({ connection: { state: EConnectionView.Waking, detail: null } })
    const seen: EConnectionView[] = [session.health().view.state]
    session.subscribe(() => seen.push(session.health().view.state))

    channel.moveTo(CONNECTED)
    channel.moveTo({ state: EConnectionView.Reconnecting, detail: null })
    channel.moveTo({ state: EConnectionView.Disconnected, detail: 'did not reopen after 5 attempts' })

    expect(seen).toEqual([
      EConnectionView.Waking,
      EConnectionView.Connected,
      EConnectionView.Reconnecting,
      EConnectionView.Disconnected,
    ])
    expect(session.health().view.detail).toBe('did not reopen after 5 attempts')
  })

  it('announces nothing when the view did not change', () => {
    const { channel, session } = sessionOn()
    let announced = 0
    session.subscribe(() => {
      announced += 1
    })

    channel.announce()

    expect(announced).toBe(0)
  })

  it('carries the last time the transcript was applied', () => {
    const { session } = sessionOn({ appliedAt: 1234 })

    expect(session.health().lastSeenAt).toBe(1234)
  })
})

describe('a channel that cannot resume its delta buffer', () => {
  it('hands the reload on so the durable log is read again', () => {
    const { channel, reloads } = sessionOn()

    channel.reload({ sinceEventSeq: 42 })

    expect(reloads).toEqual([{ sinceEventSeq: 42 }])
  })

  it('stops listening once the session is closed', () => {
    const { channel, session, reloads } = sessionOn()

    session.close()
    channel.reload({ sinceEventSeq: 7 })

    expect(reloads).toEqual([])
    expect(channel.closed).toBe(true)
  })

  it('hands a reload on only once the socket can back the resync reads', () => {
    const { channel, reloads } = sessionOn()

    channel.moveTo({ state: EConnectionView.Reconnecting, detail: null })
    channel.reload({ sinceEventSeq: 42 })
    expect(reloads).toEqual([])

    channel.moveTo(CONNECTED)
    expect(reloads).toEqual([{ sinceEventSeq: 42 }])
  })

  it('keeps only the oldest gap across reloads that land while the socket is down', () => {
    const { channel, reloads } = sessionOn()
    channel.moveTo({ state: EConnectionView.Reconnecting, detail: null })

    channel.reload({ sinceEventSeq: 42 })
    channel.reload({ sinceEventSeq: 51 })
    channel.moveTo(CONNECTED)

    expect(reloads).toEqual([{ sinceEventSeq: 42 }])
  })

  it('never forwards a reload once the session is closed, even when the socket comes back', () => {
    const { channel, session, reloads } = sessionOn()
    channel.moveTo({ state: EConnectionView.Reconnecting, detail: null })
    channel.reload({ sinceEventSeq: 42 })

    session.close()
    channel.moveTo(CONNECTED)

    expect(reloads).toEqual([])
  })
})

describe('stale: a reload in flight', () => {
  it('reads stale from the gap until the resync lands, and only then', async () => {
    const resync = deferred()
    const { channel, session } = sessionOn({ onReload: () => resync.promise })
    expect(session.health().stale).toBe(false)

    channel.reload({ sinceEventSeq: 5 })
    await tick()
    expect(session.health().stale).toBe(true)

    resync.resolve()
    await tick()
    expect(session.health().stale).toBe(false)
  })

  it('stays stale while the reload waits out a dropped socket', () => {
    const { channel, session } = sessionOn()
    channel.moveTo({ state: EConnectionView.Reconnecting, detail: null })

    channel.reload({ sinceEventSeq: 5 })

    expect(session.health().stale).toBe(true)
  })

  it('runs reloads one at a time and needs only the latest to succeed', async () => {
    const first = deferred()
    const second = deferred()
    const requested: CloudReload[] = []
    const { channel, session } = sessionOn({
      onReload: (reload) => {
        requested.push(reload)
        return requested.length === 1 ? first.promise : second.promise
      },
      settleMs: 1_000_000,
    })

    channel.reload({ sinceEventSeq: 5 })
    channel.reload({ sinceEventSeq: 9 })
    await tick()
    expect(requested).toEqual([{ sinceEventSeq: 5 }])

    first.reject(new Error('the cloud attachment is no longer mounted'))
    await tick()
    expect(requested).toEqual([{ sinceEventSeq: 5 }, { sinceEventSeq: 9 }])
    expect(session.health().stale).toBe(true)

    second.resolve()
    await tick()
    expect(session.health().stale).toBe(false)
  })

  it('retries a reload whose resync rejected, so a birth-window failure cannot leave the socket dimmed forever', async () => {
    let attempts = 0
    const { channel, session } = sessionOn({
      onReload: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('the cloud attachment is no longer mounted')
      },
      settleMs: 5,
    })

    channel.reload({ sinceEventSeq: 0 })
    await tick()
    expect(attempts).toBe(1)
    expect(session.health().stale).toBe(true)

    await Bun.sleep(20)
    await tick()

    expect(attempts).toBe(2)
    expect(session.health().stale).toBe(false)
    expect(session.health().view.state).toBe(EConnectionView.Connected)
  })
})

describe('what the sandbox itself refuses', () => {
  it('keeps an error frame that arrives over a healthy socket, without touching the view', () => {
    const { channel, session } = sessionOn()

    channel.fail('workspace failed at git apply: patch does not apply')

    expect(session.health().view).toEqual(CONNECTED)
    expect(session.health().failure).toContain('git apply')
  })

  it('never keeps a transport error — the view already narrates it', () => {
    const { channel, session } = sessionOn()

    channel.failTransport('The session socket reported an error.')

    expect(session.health().failure).toBeNull()
  })

  it('clears the failure when a turn completes after it', () => {
    const { channel, session } = sessionOn()
    channel.fail('The Atlas Cloud API answered with 500: Internal server error.')

    channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-1') })

    expect(session.health().failure).toBeNull()
  })

  it('keeps the failure when the next turn fails too', () => {
    const { channel, session } = sessionOn()
    channel.fail('workspace failed at git apply: patch does not apply')

    channel.endTurn({ status: ETurnStatus.Failed, runId: toRunId('run-1'), message: 'the model fell over', cause: null })

    expect(session.health().failure).toContain('git apply')
  })
})
