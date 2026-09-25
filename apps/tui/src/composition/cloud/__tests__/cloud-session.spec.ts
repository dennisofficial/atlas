import { describe, expect, it } from 'bun:test'

import { EChannelConnection, ETurnStatus } from '@dltech/atlas-harness'
import { toRunId } from '@dltech/atlas-core'

import { ECloudSandboxState, type CloudReload, type CloudSandboxStatus } from '@dltech/atlas-harness'
import { createCloudSession } from '../cloud-session'
import { fakeCloudChannel } from './fixture'

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const sessionOn = (args: { status?: CloudSandboxStatus | undefined } = {}) => {
  const channel = fakeCloudChannel()
  const reloads: CloudReload[] = []
  const session = createCloudSession({
    channel,
    sandboxes: {
      create: async () => ({ url: '', token: '', state: ECloudSandboxState.Running, created: false }),
      putContext: async () => undefined,
      find: async () => args.status,
      destroy: async () => undefined,
    },
    onReload: (reload) => reloads.push(reload),
  })

  return { channel, session, reloads }
}

describe('what the operator is told about the socket', () => {
  it('follows the channel through connecting, open and reconnecting', () => {
    const { channel, session } = sessionOn()
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

  it('reads a socket that will not reopen as parked when the control plane says parked', async () => {
    const { channel, session } = sessionOn({
      status: { state: ECloudSandboxState.Parked },
    })

    channel.moveTo({ state: EChannelConnection.Closed, detail: 'gave up after 8 attempts' })
    await settled()

    expect(session.health().connection).toEqual({ state: EChannelConnection.Parked, detail: null })
  })

  it('reads a resuming sandbox as reconnecting rather than as a failure', async () => {
    const { channel, session } = sessionOn({
      status: { state: ECloudSandboxState.Resuming },
    })

    channel.moveTo({ state: EChannelConnection.Closed, detail: null })
    await settled()

    expect(session.health().connection.state).toBe(EChannelConnection.Reconnecting)
  })

  it('stays closed when the control plane has never heard of the sandbox', async () => {
    const { channel, session } = sessionOn({ status: undefined })

    channel.moveTo({ state: EChannelConnection.Closed, detail: null })
    await settled()

    expect(session.health().connection.state).toBe(EChannelConnection.Closed)
    expect(session.health().connection.detail).toContain('no sandbox')
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

    channel.fail("this Atlas speaks a newer wire protocol (9) than this sandbox's serve (1) — re-open the conversation so the sandbox's serve is rebuilt")
    channel.moveTo({ state: EChannelConnection.Closed, detail: 'wire protocol mismatch' })
    await settled()

    expect(session.health().connection.detail).toBe('wire protocol mismatch')
    expect(session.health().failure).toContain('wire protocol')
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
