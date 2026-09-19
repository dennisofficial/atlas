import { describe, expect, it } from 'bun:test'

import { EStepEnd } from '../../channel/signal'
import {
  bearerSubprotocolOf,
  CHANNEL_SUBPROTOCOL,
  encodeFrame,
  EServeFrame,
} from '../channel-wire'
import { EChannelConnection } from '../remote-delta-channel'
import { harness, recorder, started, THREAD } from './remote-channel-fixture'

describe('escalating to a re-attach when the socket stays dead', () => {
  const deferred = <T>() => {
    let resolve: (value: T) => void = () => undefined
    let reject: (failure: Error) => void = () => undefined
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  it('reports itself re-attaching while the re-attach is in flight', async () => {
    const pending = deferred<{ url: string; token: string }>()
    const { channel, open, receive, drop, retries, live } = harness({
      maxAttempts: 1,
      reattach: () => pending.promise,
    })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })

    drop()
    retries[0]?.run()
    live().handlers.handleClose()

    expect(channel.connection().state).toBe(EChannelConnection.Reattaching)

    pending.resolve({ url: 'https://fresh.test/', token: 'tok_fresh' })
    await Bun.sleep(1)
    expect(channel.connection().state).toBe(EChannelConnection.Connecting)
  })

  it('dials the attachment the re-attach answered with', async () => {
    const { channel, open, receive, drop, retries, sockets, live } = harness({
      maxAttempts: 1,
      reattach: async () => ({ url: 'https://fresh.test/', token: 'tok_fresh' }),
    })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    drop()
    retries[0]?.run()
    live().handlers.handleClose()
    await Bun.sleep(1)

    expect(sockets).toHaveLength(3)
    expect(live().url).toBe('wss://fresh.test/v1/session')
    expect(live().protocols).toEqual([CHANNEL_SUBPROTOCOL, bearerSubprotocolOf('tok_fresh')])
    expect(channel.connection().state).toBe(EChannelConnection.Connecting)

    live().handlers.handleOpen()
    live().handlers.handleMessage(encodeFrame({ kind: EServeFrame.Ready, seq: 1 }))
    expect(channel.connection().state).toBe(EChannelConnection.Open)
  })

  it('closes with both reasons when the re-attach itself fails', async () => {
    const { channel, open, receive, drop, retries, live } = harness({
      maxAttempts: 1,
      reattach: async () => {
        throw new Error('timed out waiting for the sandbox')
      },
    })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    drop()
    retries[0]?.run()
    live().handlers.handleClose()
    await Bun.sleep(1)

    expect(channel.connection().state).toBe(EChannelConnection.Closed)
    expect(channel.connection().detail).toContain('did not reopen after 1 attempts')
    expect(channel.connection().detail).toContain('timed out waiting for the sandbox')
  })

  it('ends the step in flight when the escalation begins, since the relaunched serve kills it', async () => {
    const pending = deferred<{ url: string; token: string }>()
    const { channel, open, receive, drop, retries, live } = harness({
      maxAttempts: 1,
      reattach: () => pending.promise,
    })
    const { seen, listener } = recorder()
    channel.subscribe({ threadId: THREAD, listener })
    open()
    receive({ kind: EServeFrame.Signal, seq: 1, signal: started })
    drop()
    retries[0]?.run()
    live().handlers.handleClose()

    expect(seen.at(-1)).toMatchObject({ type: 'step-ended', end: EStepEnd.Failed })
    expect(channel.snapshot({ threadId: THREAD })).toEqual([])
    pending.resolve({ url: 'https://fresh.test/', token: 'tok_fresh' })
    await Bun.sleep(1)
  })

  it('stops escalating after the re-attach ceiling and closes', async () => {
    let reattachments = 0
    const { channel, open, receive, drop, retries, live } = harness({
      maxAttempts: 1,
      maxReattachments: 1,
      reattach: async () => {
        reattachments += 1
        return { url: 'https://fresh.test/', token: 'tok_fresh' }
      },
    })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })

    drop()
    retries[0]?.run()
    live().handlers.handleClose()
    await Bun.sleep(1)
    expect(channel.connection().state).toBe(EChannelConnection.Connecting)
    expect(reattachments).toBe(1)

    live().handlers.handleClose()
    retries.at(-1)?.run()
    live().handlers.handleClose()
    await Bun.sleep(1)

    expect(reattachments).toBe(1)
    expect(channel.connection().state).toBe(EChannelConnection.Closed)
  })

  it('earns the escalation budget back on a ready socket', async () => {
    let reattachments = 0
    const { channel, open, receive, drop, retries, live } = harness({
      maxAttempts: 1,
      maxReattachments: 1,
      reattach: async () => {
        reattachments += 1
        return { url: 'https://fresh.test/', token: 'tok_fresh' }
      },
    })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })

    drop()
    retries[0]?.run()
    live().handlers.handleClose()
    await Bun.sleep(1)
    live().handlers.handleOpen()
    live().handlers.handleMessage(encodeFrame({ kind: EServeFrame.Ready, seq: 1 }))

    drop()
    retries.at(-1)?.run()
    live().handlers.handleClose()
    await Bun.sleep(1)

    expect(reattachments).toBe(2)
    expect(channel.connection().state).toBe(EChannelConnection.Connecting)
  })

  it('ignores a re-attach answer that lands after a wake already moved on', async () => {
    const pending = deferred<{ url: string; token: string }>()
    const { channel, open, receive, drop, retries, sockets, live } = harness({
      maxAttempts: 1,
      reattach: () => pending.promise,
    })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    drop()
    retries[0]?.run()
    live().handlers.handleClose()

    channel.wake({ url: 'https://woken.test/', token: 'tok_woken' })
    pending.resolve({ url: 'https://stale.test/', token: 'tok_stale' })
    await Bun.sleep(1)

    expect(live().url).toBe('wss://woken.test/v1/session')
    expect(sockets.filter((socket) => socket.url.includes('stale'))).toHaveLength(0)
  })
})
