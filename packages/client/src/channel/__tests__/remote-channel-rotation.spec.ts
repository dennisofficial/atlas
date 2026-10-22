import { describe, expect, it } from 'bun:test'

import { EServeFrame } from '../channel-wire'
import { EConnectionView, type ConnectionView } from '../connection-view'
import { deferred, harness, readied } from './remote-channel-fixture'

const FRESH = { url: 'https://fresh.test/', token: 'tok_fresh' }

const UPDATING: ConnectionView = { state: EConnectionView.Updating, detail: 'updating the pod' }

describe('a wake that turns out to be a serve swap', () => {
  it('reads Updating once the provision starts rotating, then Connected after the attach', async () => {
    const pending = deferred<{ url: string; token: string }>()
    let rotate: () => void = () => undefined
    const { channel, drop, open, receive } = readied({
      maxAttempts: 0,
      wakeSandbox: ({ onRotationStarted }) => {
        rotate = onRotationStarted
        return pending.promise
      },
    })
    drop()
    const views: EConnectionView[] = []
    channel.onConnection((view) => views.push(view.state))

    channel.reconnect()
    expect(channel.connection().state).toBe(EConnectionView.Waking)

    rotate()
    expect(channel.connection()).toEqual(UPDATING)

    pending.resolve(FRESH)
    await Bun.sleep(1)
    expect(channel.connection()).toEqual(UPDATING)

    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })

    expect(channel.connection().state).toBe(EConnectionView.Connected)
    expect(views).toEqual([
      EConnectionView.Waking,
      EConnectionView.Updating,
      EConnectionView.Connected,
    ])
  })

  it('drops the swap when the wake fails, reading Disconnected with the reason', async () => {
    const pending = deferred<{ url: string; token: string }>()
    const { channel, drop } = readied({
      maxAttempts: 0,
      wakeSandbox: ({ onRotationStarted }) => {
        onRotationStarted()
        return pending.promise
      },
    })
    drop()

    channel.reconnect()
    expect(channel.connection()).toEqual(UPDATING)

    pending.reject(new Error('drain never sealed'))
    await Bun.sleep(1)

    expect(channel.connection()).toEqual({
      state: EConnectionView.Disconnected,
      detail: 'the pod could not be woken: drain never sealed',
    })
  })

  it('ignores a rotation announced by a wake a newer one already superseded', async () => {
    const pending = deferred<{ url: string; token: string }>()
    let rotate: () => void = () => undefined
    const { channel, drop } = readied({
      maxAttempts: 0,
      wakeSandbox: ({ onRotationStarted }) => {
        rotate = onRotationStarted
        return pending.promise
      },
    })
    drop()

    channel.reconnect()
    channel.wake(FRESH)
    rotate()

    expect(channel.connection().state).toBe(EConnectionView.Waking)
    pending.resolve(FRESH)
    await Bun.sleep(1)
  })
})

describe('a swap announced by a wake the caller ran itself', () => {
  it('reads Updating from beginRotation through the attachment handover, then Connected at greet', () => {
    const detached = harness({ unattached: true })

    detached.channel.beginWake()
    detached.channel.beginRotation()
    expect(detached.channel.connection()).toEqual(UPDATING)

    detached.channel.wake(FRESH)
    expect(detached.channel.connection()).toEqual(UPDATING)

    detached.open()
    detached.receive({ kind: EServeFrame.Ready, seq: 1 })
    expect(detached.channel.connection().state).toBe(EConnectionView.Connected)
  })

  it('clears the swap when the caller-run wake fails', () => {
    const detached = harness({ unattached: true })

    detached.channel.beginWake()
    detached.channel.beginRotation()
    detached.channel.failWake({ reason: 'the pod could not be woken: drain never sealed' })

    expect(detached.channel.connection()).toEqual({
      state: EConnectionView.Disconnected,
      detail: 'the pod could not be woken: drain never sealed',
    })
  })

  it('starts the next wake as Waking, not as the swap a previous wake ran', () => {
    const { channel, drop } = readied({
      maxAttempts: 0,
      wakeSandbox: () => new Promise(() => undefined),
    })
    drop()
    channel.beginRotation()
    expect(channel.connection()).toEqual(UPDATING)

    channel.reconnect()

    expect(channel.connection().state).toBe(EConnectionView.Waking)
  })

  it('leaves a live socket Connected when beginRotation arrives late', () => {
    const { channel } = readied()

    channel.beginRotation()

    expect(channel.connection().state).toBe(EConnectionView.Connected)
  })
})
