import { describe, expect, it } from 'bun:test'

import { toEventId, toRunId, type Event, type EventOfType } from '@dltech/atlas-core'

import {
  EChannelConnection,
  ECloudFreshness,
  ECloudSandboxLifecycle,
  ECloudSandboxState,
  ERuntimePhase,
  type CloudReload,
  type CloudSandboxStatus,
  type RuntimeCheckpoint,
} from '@dltech/atlas-harness'

import { createCloudSession, type CloudSession } from '../cloud-session'
import { CLOUD_THREAD, fakeCloudChannel, type FakeCloudChannel } from './fixture'

const tick = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

const deferred = <T>(): Deferred<T> => {
  let resolve: ((value: T) => void) | null = null
  let reject: ((error: unknown) => void) | null = null
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return {
    promise,
    resolve: (value) => resolve?.(value),
    reject: (error) => reject?.(error),
  }
}

const parkedEvent = (args: { seq: number; shellsRunning?: number }): EventOfType<'parked'> => ({
  id: toEventId(`event-${args.seq}`),
  seq: args.seq,
  threadId: CLOUD_THREAD,
  runId: toRunId('run-1'),
  depth: 0,
  at: '2026-10-01T00:00:00.000Z',
  type: 'parked',
  reason: 'idle',
  turnRunning: false,
  childrenRunning: 0,
  shellsRunning: args.shellsRunning ?? 0,
  servicesRunning: 0,
  clientsAttached: 0,
})

const checkpointOf = (overrides: Partial<RuntimeCheckpoint> = {}): RuntimeCheckpoint => ({
  threadId: CLOUD_THREAD,
  runtimeId: 'runtime-1',
  sandboxSessionId: 'session-a',
  revision: 2,
  phase: ERuntimePhase.Parked,
  reportedAt: '2026-10-01T00:00:00.000Z',
  transcript: { head: 10, count: 10, digest: 'a'.repeat(64) },
  ...overrides,
})

const sessionOn = (args: {
  channel?: FakeCloudChannel
  find?: () => Promise<CloudSandboxStatus | undefined>
  onReload?: (reload: CloudReload) => Promise<void>
  appliedSnapshot?:
    | (() => {
        identity: { head: number; count: number; digest: string }
        appliedAt: number
        events?: readonly Event[] | undefined
      } | null)
    | undefined
  settleMs?: number
}): { channel: FakeCloudChannel; session: CloudSession } => {
  const channel =
    args.channel ?? fakeCloudChannel({ connection: { state: EChannelConnection.Open, detail: null } })
  const missing: CloudSandboxStatus | undefined = undefined
  const session = createCloudSession({
    channel,
    sandboxes: {
      create: async () => ({ url: '', token: '', state: ECloudSandboxState.Running, created: false }),
      putContext: async () => undefined,
      confirmLanded: async () => ({ landed: true }),
      find: args.find ?? (async () => missing),
      readResources: async () => ({}),
      updateResources: async () => {},
      destroy: async () => undefined,
    },
    onReload: args.onReload ?? (async () => undefined),
    ...(args.appliedSnapshot === undefined ? {} : { appliedSnapshot: args.appliedSnapshot }),
    ...(args.settleMs === undefined ? {} : { settleMs: args.settleMs }),
  })
  return { channel, session }
}

describe('the socket moves without waiting on the provider', () => {
  it('reports a disconnect immediately while the provider inspection is still in flight', async () => {
    const answer = deferred<CloudSandboxStatus | undefined>()
    const { channel, session } = sessionOn({ find: () => answer.promise })

    channel.moveTo({ state: EChannelConnection.Closed, detail: 'gave up after 8 attempts' })

    expect(session.health().connection.state).toBe(EChannelConnection.Closed)
    expect(session.health().stale).toBe(true)

    answer.resolve({ state: ECloudSandboxState.Running })
    await tick()
    expect(session.health().sandbox).toBe(ECloudSandboxLifecycle.Running)
  })

  it('marks a running sandbox stale on disconnect without naming anything at fault', async () => {
    const { channel, session } = sessionOn({
      find: async () => ({ state: ECloudSandboxState.Running }),
    })

    channel.moveTo({ state: EChannelConnection.Closed, detail: 'gave up after 8 attempts' })
    await tick()

    expect(session.health().sandbox).toBe(ECloudSandboxLifecycle.Running)
    expect(session.health().stale).toBe(true)
    expect(session.health().failure).toBeNull()
  })

  it('dims a parked session whose synced transcript tail is not the parked marker', async () => {
    const applied = { head: 10, count: 10, digest: 'a'.repeat(64) }
    const { channel, session } = sessionOn({
      find: async () => ({
        state: ECloudSandboxState.Parked,
        sandboxSessionId: 'session-a',
        checkpoint: checkpointOf(),
      }),
      appliedSnapshot: () => ({ identity: applied, appliedAt: 1000 }),
    })

    channel.moveTo({ state: EChannelConnection.Closed, detail: null })
    await tick()

    expect(session.health().sandbox).toBe(ECloudSandboxLifecycle.Parked)
    expect(session.health().freshness).toBe(ECloudFreshness.Synced)
    expect(session.health().stale).toBe(true)
    expect(session.health().lastSeenAt).toBe(1000)
  })

  it('ungrays a parked session whose synced transcript ends in the parked marker', async () => {
    const applied = { head: 10, count: 10, digest: 'a'.repeat(64) }
    const tail: readonly EventOfType<'parked'>[] = [
      parkedEvent({ seq: 10, shellsRunning: 1 }),
    ]
    const { channel, session } = sessionOn({
      find: async () => ({
        state: ECloudSandboxState.Parked,
        sandboxSessionId: 'session-a',
        checkpoint: checkpointOf(),
      }),
      appliedSnapshot: () => ({ identity: applied, appliedAt: 1000, events: tail }),
    })

    channel.moveTo({ state: EChannelConnection.Closed, detail: null })
    await tick()

    expect(session.health().sandbox).toBe(ECloudSandboxLifecycle.Parked)
    expect(session.health().freshness).toBe(ECloudFreshness.Synced)
    expect(session.health().stale).toBe(false)
  })

  it('dims a parked session whose tail marker arrives on an unproven transcript', async () => {
    const tail: readonly EventOfType<'parked'>[] = [parkedEvent({ seq: 99 })]
    const { channel, session } = sessionOn({
      find: async () => ({
        state: ECloudSandboxState.Parked,
        sandboxSessionId: 'session-a',
        checkpoint: checkpointOf({ transcript: { head: 99, count: 99, digest: 'b'.repeat(64) } }),
      }),
      appliedSnapshot: () => ({ identity: { head: 10, count: 10, digest: 'a'.repeat(64) }, appliedAt: 1000, events: tail }),
    })

    channel.moveTo({ state: EChannelConnection.Closed, detail: null })
    await tick()

    expect(session.health().sandbox).toBe(ECloudSandboxLifecycle.Parked)
    expect(session.health().freshness).toBe(ECloudFreshness.Behind)
    expect(session.health().stale).toBe(true)
  })
})

describe('a reload resync that cannot apply', () => {
  it('never ungrays: the socket reopening alone is not synced', async () => {
    const resync = deferred<void>()
    const { channel, session } = sessionOn({ onReload: () => resync.promise })

    channel.moveTo({ state: EChannelConnection.Reconnecting, detail: null })
    channel.reload({ sinceEventSeq: 5 })
    channel.moveTo({ state: EChannelConnection.Open, detail: null })
    await tick()
    expect(session.health().stale).toBe(true)

    resync.reject(new Error('the cloud attachment is no longer mounted'))
    await tick()

    expect(session.health().connection.state).toBe(EChannelConnection.Open)
    expect(session.health().stale).toBe(true)
    expect(session.health().failure).toBeNull()
  })

  it('resolves only after the view has applied the resync, per the callback contract', async () => {
    const applied = deferred<void>()
    const { channel, session } = sessionOn({
      onReload: async () => {
        await applied.promise
      },
    })

    channel.reload({ sinceEventSeq: 5 })
    await tick()
    expect(session.health().stale).toBe(true)

    applied.resolve()
    await tick()
    expect(session.health().stale).toBe(false)
  })
})

describe('reloads that land while a resync runs', () => {
  it('runs them one at a time and needs only the latest to succeed', async () => {
    const first = deferred<void>()
    const second = deferred<void>()
    const requested: CloudReload[] = []
    const { channel, session } = sessionOn({
      onReload: (reload) => {
        requested.push(reload)
        return requested.length === 1 ? first.promise : second.promise
      },
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
})

describe('an answer that arrives late', () => {
  it('cannot let an old provider inspection override a newer open', async () => {
    const answer = deferred<CloudSandboxStatus | undefined>()
    const resync = deferred<void>()
    const { channel, session } = sessionOn({
      find: () => answer.promise,
      onReload: () => resync.promise,
    })

    channel.moveTo({ state: EChannelConnection.Closed, detail: null })
    channel.moveTo({ state: EChannelConnection.Open, detail: null })

    answer.resolve({
      state: ECloudSandboxState.Parked,
      sandboxSessionId: 'session-a',
      checkpoint: checkpointOf(),
    })
    await tick()

    expect(session.health().connection.state).toBe(EChannelConnection.Open)
    expect(session.health().sandbox).toBe(ECloudSandboxLifecycle.Running)
    expect(session.health().stale).toBe(true)
  })

  it('cannot ungray from a resync that a disconnect and a newer reload overtook', async () => {
    const resyncs: { reload: CloudReload; done: Deferred<void> }[] = []
    const { channel, session } = sessionOn({
      onReload: (reload) => {
        const done = deferred<void>()
        resyncs.push({ reload, done })
        return done.promise
      },
    })

    channel.reload({ sinceEventSeq: 5 })
    await tick()
    expect(resyncs).toHaveLength(1)

    channel.moveTo({ state: EChannelConnection.Reconnecting, detail: null })
    channel.reload({ sinceEventSeq: 9 })
    resyncs[0]?.done.resolve()
    await tick()
    expect(session.health().stale).toBe(true)

    channel.moveTo({ state: EChannelConnection.Open, detail: null })
    await tick()
    expect(session.health().stale).toBe(true)
    expect(resyncs).toHaveLength(2)
    expect(resyncs[1]?.reload).toEqual({ sinceEventSeq: 9 })

    resyncs[1]?.done.resolve()
    await tick()
    expect(session.health().stale).toBe(false)
  })
})

describe('provider inspection is read-only', () => {
  it('provisions and wakes nothing while it inspects, even for a parked checkpoint', async () => {
    const calls: string[] = []
    const channel = fakeCloudChannel({
      connection: { state: EChannelConnection.Open, detail: null },
    })
    const session = createCloudSession({
      channel,
      sandboxes: {
        create: async () => {
          calls.push('create')
          return { url: '', token: '', state: ECloudSandboxState.Running, created: true }
        },
        putContext: async () => {
          calls.push('put-context')
        },
        confirmLanded: async () => ({ landed: true }),
        find: async () => ({
          state: ECloudSandboxState.Parked,
          sandboxSessionId: 'session-a',
          checkpoint: checkpointOf(),
        }),
        readResources: async () => ({}),
        updateResources: async () => {},
        destroy: async () => {
          calls.push('destroy')
        },
      },
      onReload: async () => undefined,
      settleMs: 1_000_000,
    })

    channel.moveTo({ state: EChannelConnection.Closed, detail: null })
    channel.moveTo({ state: EChannelConnection.Parked, detail: null })
    channel.pushCheckpoint(checkpointOf())
    await tick()

    expect(calls).toEqual([])
    expect(channel.woken).toEqual([])

    session.close()
  })
})
