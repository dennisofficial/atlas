import { describe, expect, it } from 'bun:test'
import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import { EChannelConnection } from '../remote-delta-channel'
import { EClientFrame, EServeFrame } from '../channel-wire'

import { harness, started, THREAD } from './remote-channel-fixture'

const CHECKPOINT: RuntimeCheckpoint = {
  threadId: 'brn_cloud',
  runtimeId: 'runtime-1',
  sandboxSessionId: 'sandbox-1',
  revision: 4,
  phase: ERuntimePhase.Parked,
  reportedAt: '2026-10-01T18:17:00.000Z',
  transcript: { head: 31, count: 31, digest: 'a'.repeat(64) },
}

describe('a checkpoint the serve reports', () => {
  it('exposes the latest one and emits it to listeners', async () => {
    const { channel, open, receive } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })

    const seen: unknown[] = []
    channel.onCheckpoint?.((checkpoint) => seen.push(checkpoint))

    receive({
      kind: EServeFrame.Ready,
      seq: 2,
      checkpoint: CHECKPOINT,
    })

    expect(seen).toEqual([CHECKPOINT])
    expect(channel.checkpoint?.()).toEqual(CHECKPOINT)
  })

  it('accepts the bare checkpoint frame', async () => {
    const { channel, open, receive } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })

    const seen: unknown[] = []
    channel.onCheckpoint?.((checkpoint) => seen.push(checkpoint))

    receive({ kind: EServeFrame.Checkpoint, checkpoint: { ...CHECKPOINT, revision: 5 } })

    expect(seen).toEqual([{ ...CHECKPOINT, revision: 5 }])
    expect(channel.checkpoint?.()?.revision).toBe(5)
  })

  it('reads a checkpoint off a parked frame before the connection moves', async () => {
    const { channel, open, receive } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })

    receive({
      kind: EServeFrame.Parked,
      reason: 'idle past the ttl',
      checkpoint: { ...CHECKPOINT, revision: 7 },
    })

    expect(channel.checkpoint?.()?.revision).toBe(7)
    expect(channel.connection().state).toBe(EChannelConnection.Parked)
  })

  it('accepts a checkpoint on a frame this build cannot decode, without failing the frame', async () => {
    const { channel, open, receive, live } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })

    const failures: string[] = []
    channel.onError((failure) => failures.push(failure.message))
    const seen: unknown[] = []
    channel.onCheckpoint?.((checkpoint) => seen.push(checkpoint))

    live().handlers.handleMessage(
      JSON.stringify({ kind: 'future-checkpoint', checkpoint: { ...CHECKPOINT, revision: 8 } }),
    )

    expect(seen).toEqual([{ ...CHECKPOINT, revision: 8 }])
    expect(failures).toEqual([])
  })

  it('ignores an older or same-revision checkpoint and one for another thread', async () => {
    const { channel, open, receive } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    receive({ kind: EServeFrame.Ready, seq: 2, checkpoint: CHECKPOINT })

    const seen: unknown[] = []
    channel.onCheckpoint?.((checkpoint) => seen.push(checkpoint))

    receive({ kind: EServeFrame.Checkpoint, checkpoint: { ...CHECKPOINT, revision: 3 } })
    receive({ kind: EServeFrame.Checkpoint, checkpoint: { ...CHECKPOINT, threadId: 'brn_other' } })

    expect(seen).toEqual([])
    expect(channel.checkpoint?.()?.revision).toBe(4)
  })
})

describe('detaching from a session', () => {
  it('announces the detach, drops in-flight state, and closes the socket without reconnecting', async () => {
    const { channel, open, receive, live, retries } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    receive({ kind: EServeFrame.Signal, seq: 1, signal: started })

    const detached: string[] = []
    channel.onDetached?.((reason) => detached.push(reason))
    const connections: EChannelConnection[] = []
    channel.onConnection((connection) => connections.push(connection.state))

    const socket = live()
    channel.detach?.()
    socket.handlers.handleClose()

    expect(detached).toHaveLength(1)
    expect(detached[0]).toContain('detached')
    expect(channel.snapshot({ threadId: THREAD })).toEqual([])
    expect(socket.closed).toBe(true)
    expect(channel.connection().state).toBe(EChannelConnection.Closed)
    expect(retries).toEqual([])
    expect(connections.at(-1)).toBe(EChannelConnection.Closed)
  })

  it('does not answer a further detach', async () => {
    const { channel, open, receive, live } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })

    const detached: string[] = []
    channel.onDetached?.((reason) => detached.push(reason))

    channel.detach?.()
    channel.detach?.()

    expect(detached).toHaveLength(1)
    expect(live().closed).toBe(true)
  })
})

describe('interrupting while the channel is parked', () => {
  it('queues the interrupt frame rather than writing to a dead socket', async () => {
    const { channel, open, receive, drop, live } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    receive({ kind: EServeFrame.Parked, reason: 'idle past the ttl' })
    drop()

    expect(channel.connection().state).toBe(EChannelConnection.Parked)

    channel.interrupt()

    const sentWhileParked = live().sent.filter((frame) => frame.kind === EClientFrame.Interrupt)
    expect(sentWhileParked).toEqual([])
  })
})
