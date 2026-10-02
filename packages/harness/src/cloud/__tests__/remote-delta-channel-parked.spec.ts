import { describe, expect, it } from 'bun:test'

import { EClientFrame, EServeFrame } from '../channel-wire'
import { EChannelConnection } from '../remote-delta-channel'
import { harness } from './remote-channel-fixture'

describe('a remote channel constructed without an attachment', () => {
  it('starts parked and opens no socket, retry, or timeout', () => {
    const detached = harness({ unattached: true })

    expect(detached.channel.connection().state).toBe(EChannelConnection.Parked)
    expect(detached.sockets).toHaveLength(0)
    expect(detached.retries).toHaveLength(0)
    expect(detached.timeouts).toHaveLength(0)
  })

  it('connects only once wake hands it an attachment, then reaches open on ready', () => {
    const detached = harness({ unattached: true })

    detached.channel.wake({ url: 'https://sandbox.test/', token: 'tok_woken' })

    expect(detached.channel.connection().state).toBe(EChannelConnection.Connecting)
    expect(detached.sockets).toHaveLength(1)

    detached.open()
    detached.receive({ kind: EServeFrame.Ready, seq: 1 })

    expect(detached.channel.connection().state).toBe(EChannelConnection.Open)
    expect(detached.retries).toHaveLength(0)
  })

  it('frames sent while still parked flush once the woken channel is ready', () => {
    const detached = harness({ unattached: true })

    detached.channel.send({ text: 'queued before the wake' })
    expect(detached.sockets).toHaveLength(0)

    detached.channel.wake({ url: 'https://sandbox.test/', token: 'tok_woken' })
    detached.open()
    detached.receive({ kind: EServeFrame.Ready, seq: 1 })

    expect(detached.live().sent.some((frame) => frame.kind === EClientFrame.Send)).toBe(true)
  })

  it('offers no working replay to a subscriber before any wake', () => {
    const detached = harness({ unattached: true })

    expect(detached.channel.snapshot({ threadId: detached.channel.threadId })).toHaveLength(0)
  })

  it('leaves the parked state for the waking one when the wake begins', () => {
    const detached = harness({ unattached: true })

    detached.channel.beginWake()

    expect(detached.channel.connection().state).toBe(EChannelConnection.Waking)
    expect(detached.sockets).toHaveLength(0)
  })

  it('still rejects a forceful close by staying quiet after it', () => {
    const detached = harness({ unattached: true })

    detached.channel.close()

    expect(detached.channel.connection().state).toBe(EChannelConnection.Closed)
    expect(detached.sockets).toHaveLength(0)
    expect(detached.retries).toHaveLength(0)
  })
})
