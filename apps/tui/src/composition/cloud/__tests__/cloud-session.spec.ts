import { describe, expect, it } from 'bun:test'

import { EChannelConnection, ETurnStatus } from '@dltech/atlas-harness'
import { toRunId } from '@dltech/atlas-core'

import {
  ECloudFreshness,
  ECloudSandboxLifecycle,
  ECloudSandboxState,
  type ChannelConnection,
  type CloudReload,
  type CloudSandboxStatus,
} from '@dltech/atlas-harness'
import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'
import { createCloudSession } from '../cloud-session'
import { CLOUD_THREAD, fakeCloudChannel } from './fixture'

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const sessionOn = (
  args: {
    status?: CloudSandboxStatus | undefined
    statusRef?: { current: CloudSandboxStatus | undefined } | undefined
    connection?: ChannelConnection | undefined
    appliedSnapshot?:
      | (() => { identity: { head: number; count: number; digest: string }; appliedAt: number } | null)
      | undefined
  } = {},
) => {
  // An attach only happens once the channel has answered its Hello, so the session reads Open —
  // a spec that wants the dial itself passes `connection` and drives it by hand.
  const channel = fakeCloudChannel({
    ...(args.connection === undefined
      ? { connection: { state: EChannelConnection.Open, detail: null } }
      : { connection: args.connection }),
  })
  const reloads: CloudReload[] = []
  const session = createCloudSession({
    channel,
    sandboxes: {
      create: async () => ({ url: '', token: '', state: ECloudSandboxState.Running, created: false }),
      putContext: async () => undefined,
      putTranscript: async () => undefined,
      confirmLanded: async () => ({ landed: true }),
      find: async () => args.statusRef?.current ?? args.status,
      destroy: async () => undefined,
    },
    onReload: async (reload) => {
      reloads.push(reload)
    },
    ...(args.appliedSnapshot === undefined ? {} : { appliedSnapshot: args.appliedSnapshot }),
  })

  return { channel, session, reloads }
}

describe('what the operator is told about the socket', () => {
  it('follows the channel through connecting, open and reconnecting', () => {
    const { channel, session } = sessionOn({
      connection: { state: EChannelConnection.Connecting, detail: null },
    })
    const seen: EChannelConnection[] = [session.health().connection.state]

    session.subscribe(() => seen.push(session.health().connection.state))
    channel.moveTo({ state: EChannelConnection.Open, detail: null })
    channel.moveTo({ state: EChannelConnection.Reconnecting, detail: null })

    expect(seen).toEqual([
      EChannelConnection.Connecting,
      EChannelConnection.Open,
      EChannelConnection.Reconnecting,
    ])
  })

  it('maps a closed socket to parked once the provider reports the sandbox at rest', async () => {
    const { channel, session } = sessionOn({
      status: { state: ECloudSandboxState.Parked },
    })

    channel.moveTo({ state: EChannelConnection.Closed, detail: 'gave up after 8 attempts' })
    await settled()

    expect(session.health().connection.state).toBe(EChannelConnection.Parked)
    expect(session.health().sandbox).toBe(ECloudSandboxLifecycle.Parked)
  })

  it('never reads a resuming sandbox as a failure — the lifecycle records it as running', async () => {
    const { channel, session } = sessionOn({
      status: { state: ECloudSandboxState.Resuming },
    })

    channel.moveTo({ state: EChannelConnection.Closed, detail: null })
    await settled()

    expect(session.health().connection.state).toBe(EChannelConnection.Reconnecting)
    expect(session.health().sandbox).toBe(ECloudSandboxLifecycle.Running)
    expect(session.health().failure).toBeNull()
  })

  it('stays closed and unknown when the provider has never heard of the sandbox', async () => {
    const { channel, session } = sessionOn({ status: undefined })

    channel.moveTo({ state: EChannelConnection.Closed, detail: null })
    await settled()

    expect(session.health().connection.state).toBe(EChannelConnection.Closed)
    expect(session.health().sandbox).toBe(ECloudSandboxLifecycle.Unknown)
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
    const { channel, session, reloads } = sessionOn()
    channel.moveTo({ state: EChannelConnection.Open, detail: null })
    expect(session.health().connection.state).toBe(EChannelConnection.Open)

    channel.moveTo({ state: EChannelConnection.Reconnecting, detail: null })
    channel.reload({ sinceEventSeq: 42 })

    expect(reloads).toEqual([])

    channel.moveTo({ state: EChannelConnection.Open, detail: null })

    expect(reloads).toEqual([{ sinceEventSeq: 42 }])
  })

  it('keeps only the oldest gap across reloads that land while the socket is down', () => {
    const { channel, reloads } = sessionOn()
    channel.moveTo({ state: EChannelConnection.Reconnecting, detail: null })

    channel.reload({ sinceEventSeq: 42 })
    channel.reload({ sinceEventSeq: 51 })
    channel.moveTo({ state: EChannelConnection.Open, detail: null })

    expect(reloads).toEqual([{ sinceEventSeq: 42 }])
  })

  it('never forwards a reload once the session is closed, even when the socket comes back', () => {
    const { channel, session, reloads } = sessionOn()
    channel.moveTo({ state: EChannelConnection.Reconnecting, detail: null })
    channel.reload({ sinceEventSeq: 42 })

    session.close()
    channel.moveTo({ state: EChannelConnection.Open, detail: null })

    expect(reloads).toEqual([])
  })
})

describe('what the sandbox itself refuses', () => {
  it('keeps an error frame that arrives over a healthy socket', () => {
    const { channel, session } = sessionOn()

    channel.moveTo({ state: EChannelConnection.Open, detail: null })
    channel.fail('workspace failed at git apply: patch does not apply')

    expect(session.health().connection.state).toBe(EChannelConnection.Open)
    expect(session.health().failure).toContain('git apply')
  })

  it('leaves the socket state alone when the sandbox complains', () => {
    const { channel, session } = sessionOn()

    channel.moveTo({ state: EChannelConnection.Open, detail: null })
    channel.fail('workspace failed at git clone: repository not found')

    expect(session.health().connection.detail).toBeNull()
  })

  it('never sticks a transport error — the connection state already narrates it', () => {
    const { channel, session } = sessionOn()

    channel.failTransport('The session socket reported an error.')

    expect(session.health().failure).toBeNull()
  })

  it("keeps the sandbox's own words when it refused the socket, rather than asking why", async () => {
    const { channel, session } = sessionOn({
      status: { state: ECloudSandboxState.Running },
    })

    channel.fail("this Atlas speaks a newer wire protocol (10) than this sandbox's serve (1) — re-open the conversation so the sandbox's serve is rebuilt")
    channel.moveTo({ state: EChannelConnection.Closed, detail: 'wire protocol mismatch' })
    await settled()

    expect(session.health().connection.detail).toBe('wire protocol mismatch')
    expect(session.health().failure).toContain('wire protocol')
  })
})

describe('the sandbox lifecycle and transcript freshness', () => {
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

  const applied = { head: 10, count: 10, digest: 'a'.repeat(64) }

  const SEEN_AT = Date.parse('2026-10-01T09:41:00.000Z')

  it('starts unknown before the provider has answered', () => {
    const { session } = sessionOn({
      connection: { state: EChannelConnection.Connecting, detail: null },
    })

    expect(session.health().sandbox).toBe(ECloudSandboxLifecycle.Unknown)
    expect(session.health().freshness).toBe(ECloudFreshness.Unknown)
  })

  it('stays gray on an open socket until the applied snapshot is proven to match', async () => {
    const statusRef = {
      current: {
        state: ECloudSandboxState.Parked,
        sandboxSessionId: 'session-a',
        checkpoint: checkpointOf(),
      } as CloudSandboxStatus | undefined,
    }
    let appliedNow: { identity: { head: number; count: number; digest: string }; appliedAt: number } | null =
      null
    const { channel, session } = sessionOn({
      statusRef,
      appliedSnapshot: () => appliedNow,
    })

    expect(session.health().connection.state).toBe(EChannelConnection.Open)
    expect(session.health().stale).toBe(true)

    channel.ready({ turnInFlight: false })
    await settled()
    appliedNow = { identity: applied, appliedAt: SEEN_AT }
    channel.reload({ sinceEventSeq: 10 })
    await settled()

    expect(session.health().stale).toBe(false)
  })

  it('grays a running sandbox whose socket closed and never names the agent at fault', async () => {
    const statusRef = { current: { state: ECloudSandboxState.Running } as CloudSandboxStatus | undefined }
    const { channel, session } = sessionOn({ statusRef })

    channel.moveTo({ state: EChannelConnection.Closed, detail: 'gave up after 8 attempts' })
    await settled()

    expect(session.health().sandbox).toBe(ECloudSandboxLifecycle.Running)
    expect(session.health().stale).toBe(true)
    expect(session.health().failure).toBeNull()
  })

  it('ungrays a parked sandbox whose finalized checkpoint matches the applied snapshot', async () => {
    const statusRef = {
      current: {
        state: ECloudSandboxState.Parked,
        sandboxSessionId: 'session-a',
        checkpoint: checkpointOf(),
      } as CloudSandboxStatus | undefined,
    }
    const { channel, session } = sessionOn({
      statusRef,
      appliedSnapshot: () => ({ identity: applied, appliedAt: SEEN_AT }),
    })

    channel.moveTo({ state: EChannelConnection.Closed, detail: null })
    await settled()

    expect(session.health().sandbox).toBe(ECloudSandboxLifecycle.Parked)
    expect(session.health().freshness).toBe(ECloudFreshness.Synced)
    expect(session.health().stale).toBe(false)
    expect(session.health().lastSeenAt).toBe(SEEN_AT)
  })

  it('stays gray when the parked checkpoint does not match what was applied', async () => {
    const statusRef = {
      current: {
        state: ECloudSandboxState.Parked,
        sandboxSessionId: 'session-a',
        checkpoint: checkpointOf({ transcript: { head: 11, count: 11, digest: 'b'.repeat(64) } }),
      } as CloudSandboxStatus | undefined,
    }
    const { channel, session } = sessionOn({
      statusRef,
      appliedSnapshot: () => ({ identity: applied, appliedAt: SEEN_AT }),
    })

    channel.moveTo({ state: EChannelConnection.Closed, detail: null })
    await settled()

    expect(session.health().freshness).toBe(ECloudFreshness.Behind)
    expect(session.health().stale).toBe(true)
  })

  it('stays gray when the parked checkpoint names a sandbox session the provider never saw', async () => {
    const statusRef = {
      current: {
        state: ECloudSandboxState.Parked,
        sandboxSessionId: 'session-b',
        checkpoint: checkpointOf(),
      } as CloudSandboxStatus | undefined,
    }
    const { channel, session } = sessionOn({
      statusRef,
      appliedSnapshot: () => ({ identity: applied, appliedAt: SEEN_AT }),
    })

    channel.moveTo({ state: EChannelConnection.Closed, detail: null })
    await settled()

    expect(session.health().freshness).toBe(ECloudFreshness.Unknown)
    expect(session.health().stale).toBe(true)
  })

  it('stays gray when the provider has no sandbox for the thread', async () => {
    const { channel, session } = sessionOn({
      statusRef: { current: undefined },
      appliedSnapshot: () => ({ identity: applied, appliedAt: SEEN_AT }),
    })

    channel.moveTo({ state: EChannelConnection.Closed, detail: null })
    await settled()

    expect(session.health().sandbox).toBe(ECloudSandboxLifecycle.Unknown)
    expect(session.health().stale).toBe(true)
  })

  it('keeps the socket state when the inspection itself fails', async () => {
    const channel = fakeCloudChannel({
      connection: { state: EChannelConnection.Open, detail: null },
    })
    const session = createCloudSession({
      channel,
      sandboxes: {
        create: async () => ({ url: '', token: '', state: ECloudSandboxState.Running, created: false }),
        putContext: async () => undefined,
        putTranscript: async () => undefined,
        confirmLanded: async () => ({ landed: true }),
        find: async () => {
          throw new Error('vercel is down')
        },
        destroy: async () => undefined,
      },
      onReload: async () => undefined,
      appliedSnapshot: () => ({ identity: applied, appliedAt: SEEN_AT }),
    })

    channel.moveTo({ state: EChannelConnection.Closed, detail: 'gave up after 8 attempts' })
    await settled()

    expect(session.health().connection.state).toBe(EChannelConnection.Closed)
    expect(session.health().sandbox).toBe(ECloudSandboxLifecycle.Unknown)
    expect(session.health().stale).toBe(true)
    expect(session.health().failure).toBeNull()
  })

  it('stays gray after a reload until the resynced snapshot has been applied', async () => {
    const statusRef = {
      current: {
        state: ECloudSandboxState.Parked,
        sandboxSessionId: 'session-a',
        checkpoint: checkpointOf({ transcript: { head: 12, count: 12, digest: 'c'.repeat(64) } }),
      } as CloudSandboxStatus | undefined,
    }
    let appliedNow: { identity: { head: number; count: number; digest: string }; appliedAt: number } | null =
      { identity: applied, appliedAt: SEEN_AT }
    const resync: { current: (() => void) | null } = { current: null }
    const channel = fakeCloudChannel({
      connection: { state: EChannelConnection.Open, detail: null },
    })
    const session = createCloudSession({
      channel,
      sandboxes: {
        create: async () => ({ url: '', token: '', state: ECloudSandboxState.Running, created: false }),
        putContext: async () => undefined,
        putTranscript: async () => undefined,
        confirmLanded: async () => ({ landed: true }),
        find: async () => statusRef.current,
        destroy: async () => undefined,
      },
      onReload: () =>
        new Promise<void>((resolve) => {
          resync.current = resolve
        }),
      appliedSnapshot: () => appliedNow,
    })

    channel.moveTo({ state: EChannelConnection.Closed, detail: null })
    await settled()

    // The checkpoint moved ahead while the socket was down: parked, but behind.
    expect(session.health().freshness).toBe(ECloudFreshness.Behind)
    expect(session.health().stale).toBe(true)

    // The socket reopens and the resync is requested, but the gray holds until the resynced
    // snapshot has actually been applied — reopening alone is not synced.
    channel.moveTo({ state: EChannelConnection.Open, detail: null })
    channel.reload({ sinceEventSeq: 10 })
    await settled()
    expect(session.health().stale).toBe(true)
    expect(session.health().freshness).toBe(ECloudFreshness.Unknown)

    // Only the applied resync — whose identity now matches the checkpoint — clears the gray.
    appliedNow = { identity: { head: 12, count: 12, digest: 'c'.repeat(64) }, appliedAt: SEEN_AT }
    resync.current?.()
    await settled()

    expect(session.health().freshness).toBe(ECloudFreshness.Synced)
    expect(session.health().stale).toBe(false)
  })
})

describe('the sticky failure clearing on recovery', () => {
  it('clears the failure when a turn completes after a server error', () => {
    const { channel, session } = sessionOn()

    channel.moveTo({ state: EChannelConnection.Open, detail: null })
    channel.fail('The Atlas Cloud API answered POST /v1/threads/x/events with 500: Internal server error.')

    expect(session.health().failure).toContain('500: Internal server error')

    channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-1') })

    expect(session.health().failure).toBeNull()
  })

  it('keeps the failure when a turn fails after a server error', () => {
    const { channel, session } = sessionOn()

    channel.moveTo({ state: EChannelConnection.Open, detail: null })
    channel.fail('workspace failed at git apply: patch does not apply')

    expect(session.health().failure).toContain('git apply')

    channel.endTurn({ status: ETurnStatus.Failed, runId: toRunId('run-1'), message: 'the model fell over', cause: null })

    expect(session.health().failure).toContain('git apply')
  })

  it('does not clear a null failure on turn completion', () => {
    const { channel, session } = sessionOn()

    expect(session.health().failure).toBeNull()

    channel.endTurn({ status: ETurnStatus.Completed, runId: toRunId('run-1') })

    expect(session.health().failure).toBeNull()
  })
})
