import { describe, expect, it } from 'bun:test'

import { bearerSubprotocolOf, CHANNEL_SUBPROTOCOL, EServeFrame } from '../channel-wire'
import { EConnectionView } from '../connection-view'
import { STRANDED_STEP_END } from '../remote-delta-channel'
import { deferred, harness, readied, recorder, started, THREAD } from './remote-channel-fixture'

const FRESH = { url: 'https://fresh.test/', token: 'tok_fresh' }

describe('waking the sandbox through the injected wake', () => {
  it('reads Waking while the wake is in flight, and keeps reading it until the fresh serve greets', async () => {
    const pending = deferred<{ url: string; token: string }>()
    const { channel, drop, open, receive } = readied({ maxAttempts: 0, wakeSandbox: () => pending.promise })
    drop()

    channel.reconnect()
    expect(channel.connection().state).toBe(EConnectionView.Waking)

    pending.resolve(FRESH)
    await Bun.sleep(1)
    expect(channel.connection().state).toBe(EConnectionView.Waking)

    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    expect(channel.connection().state).toBe(EConnectionView.Connected)
  })

  it('dials the attachment the wake answered with', async () => {
    const { channel, drop, live, sockets } = readied({ maxAttempts: 0, wakeSandbox: async () => FRESH })
    drop()

    channel.reconnect()
    await Bun.sleep(1)

    expect(sockets).toHaveLength(2)
    expect(live().url).toBe('wss://fresh.test/v1/session')
    expect(live().protocols).toEqual([CHANNEL_SUBPROTOCOL, bearerSubprotocolOf('tok_fresh')])
  })

  it('retires the step in flight when the wake begins, since the relaunched serve owns it now', async () => {
    const pending = deferred<{ url: string; token: string }>()
    const { channel, open, receive, drop } = harness({ wakeSandbox: () => pending.promise })
    const { seen, listener } = recorder()
    channel.subscribe({ threadId: THREAD, listener })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    receive({ kind: EServeFrame.Signal, seq: 2, signal: started })
    drop()
    expect(seen.at(-1)).toEqual(started)

    channel.reconnect()

    expect(seen.at(-1)).toMatchObject({ type: 'step-ended', end: STRANDED_STEP_END })
    expect(channel.snapshot({ threadId: THREAD })).toEqual([])
    pending.resolve(FRESH)
    await Bun.sleep(1)
  })

  it('ignores a wake answer that lands after a caller-run wake already moved on', async () => {
    const pending = deferred<{ url: string; token: string }>()
    const { channel, drop, live, sockets } = readied({ maxAttempts: 0, wakeSandbox: () => pending.promise })
    drop()

    channel.reconnect()
    channel.wake({ url: 'https://woken.test/', token: 'tok_woken' })
    pending.resolve({ url: 'https://stale.test/', token: 'tok_stale' })
    await Bun.sleep(1)

    expect(live().url).toBe('wss://woken.test/v1/session')
    expect(sockets.filter((socket) => socket.url.includes('stale'))).toHaveLength(0)
  })

  it('ignores a wake failure that lands after a caller-run wake already moved on', async () => {
    const pending = deferred<{ url: string; token: string }>()
    const { channel, drop } = readied({ maxAttempts: 0, wakeSandbox: () => pending.promise })
    drop()

    channel.reconnect()
    channel.wake({ url: 'https://woken.test/', token: 'tok_woken' })
    pending.reject(new Error('too late to matter'))
    await Bun.sleep(1)

    expect(channel.connection().state).toBe(EConnectionView.Waking)
  })
})

describe('a manual reconnect', () => {
  it('wakes from Parked too, since the operator asked for the connection back', async () => {
    let wakes = 0
    const { channel, receive, drop } = readied({
      wakeSandbox: async () => {
        wakes += 1
        return FRESH
      },
    })
    receive({ kind: EServeFrame.Parked, reason: 'idle past the ttl' })
    drop()
    expect(channel.connection().state).toBe(EConnectionView.Parked)

    channel.reconnect()
    await Bun.sleep(1)

    expect(wakes).toBe(1)
    expect(channel.connection().state).toBe(EConnectionView.Waking)
  })

  it('is a no-op over a live socket', async () => {
    let wakes = 0
    const { channel } = readied({
      wakeSandbox: async () => {
        wakes += 1
        return FRESH
      },
    })

    channel.reconnect()
    await Bun.sleep(1)

    expect(wakes).toBe(0)
    expect(channel.connection().state).toBe(EConnectionView.Connected)
  })

  it('joins a wake already under way instead of starting a second', async () => {
    let wakes = 0
    const pending = deferred<{ url: string; token: string }>()
    const { channel, drop } = readied({
      maxAttempts: 0,
      wakeSandbox: () => {
        wakes += 1
        return pending.promise
      },
    })
    drop()

    channel.reconnect()
    channel.reconnect()

    expect(wakes).toBe(1)
    pending.resolve(FRESH)
    await Bun.sleep(1)
  })

  it('is a no-op without a wake configured', async () => {
    const { channel, drop } = readied({ maxAttempts: 0 })
    drop()
    expect(channel.connection().state).toBe(EConnectionView.Disconnected)

    channel.reconnect()
    await Bun.sleep(1)
    expect(channel.connection().state).toBe(EConnectionView.Disconnected)
  })
})

describe('a wake the caller ran itself', () => {
  it('reads Waking from beginWake and Disconnected with the reason from failWake', () => {
    const { channel, drop } = readied({ maxAttempts: 0 })
    drop()

    channel.beginWake()
    expect(channel.connection()).toEqual({ state: EConnectionView.Waking, detail: null })

    channel.failWake({ reason: 'the pod could not be woken: quota' })
    expect(channel.connection()).toEqual({
      state: EConnectionView.Disconnected,
      detail: 'the pod could not be woken: quota',
    })
  })

  it('leaves a live socket Connected when beginWake arrives late', () => {
    const { channel } = readied()

    channel.beginWake()

    expect(channel.connection().state).toBe(EConnectionView.Connected)
  })
})
