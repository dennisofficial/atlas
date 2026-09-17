import { describe, expect, it } from 'bun:test'

import { toRunId } from '@dltech/atlas-core'

import { EStepEnd } from '../../channel/signal'
import { ETurnStatus, type TurnOutcome } from '../../loop/turn-outcome'
import {
  bearerSubprotocolOf,
  CHANNEL_SUBPROTOCOL,
  EClientFrame,
  encodeFrame,
  EServeFrame,
} from '../channel-wire'
import {
  EChannelConnection,
  RemotePublishRefused,
  type ChannelReload,
} from '../remote-delta-channel'
import {
  chunkSignal,
  harness,
  OTHER_THREAD,
  recorder,
  started,
  STEP,
  THREAD,
} from './remote-channel-fixture'

describe('opening the session socket', () => {
  it('dials the sandbox session path over wss with the auth subprotocols', () => {
    const { live } = harness()

    expect(live().url).toBe('wss://sandbox.test/v1/session')
    expect(live().protocols).toEqual([CHANNEL_SUBPROTOCOL, 'bearer.tok_session'])
  })

  it('sends hello first, carrying no channel cursor and the durable head', () => {
    const { open, live } = harness({ lastEventSeq: 12 })

    open()

    expect(live().sent[0]).toEqual({
      kind: EClientFrame.Hello,
      threadId: THREAD,
      channelCursor: null,
      lastEventSeq: 12,
    })
  })

  it('reports itself connecting until the server is ready', () => {
    const { channel, open, receive } = harness()
    const states: EChannelConnection[] = []
    channel.onConnection((connection) => void states.push(connection.state))

    expect(channel.connection().state).toBe(EChannelConnection.Connecting)
    open()
    receive({ kind: EServeFrame.Ready, seq: 4 })

    expect(channel.connection().state).toBe(EChannelConnection.Open)
    expect(states).toEqual([EChannelConnection.Open])
  })
})

describe('signals arriving from the sandbox', () => {
  it('fans the inner signal out unchanged and in order', () => {
    const { channel, open, receive } = harness()
    const { seen, listener } = recorder()
    channel.subscribe({ threadId: THREAD, listener })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })

    receive({ kind: EServeFrame.Signal, seq: 2, signal: started })
    receive({ kind: EServeFrame.Signal, seq: 3, signal: chunkSignal('auth ') })
    receive({ kind: EServeFrame.Signal, seq: 4, signal: chunkSignal('and the router') })

    expect(seen).toEqual([started, chunkSignal('auth '), chunkSignal('and the router')])
  })

  it('replays the step in flight into a late subscriber, then continues live', () => {
    const { channel, open, receive } = harness()
    open()
    receive({ kind: EServeFrame.Signal, seq: 1, signal: started })
    receive({ kind: EServeFrame.Signal, seq: 2, signal: chunkSignal('auth ') })

    const { seen, listener } = recorder()
    channel.subscribe({ threadId: THREAD, listener })
    receive({ kind: EServeFrame.Signal, seq: 3, signal: chunkSignal('and the router') })

    expect(seen).toEqual([started, chunkSignal('auth '), chunkSignal('and the router')])
  })

  it('snapshots the buffered step with a stable frozen copy', () => {
    const { channel, open, receive } = harness()
    open()
    receive({ kind: EServeFrame.Signal, seq: 1, signal: started })
    receive({ kind: EServeFrame.Signal, seq: 2, signal: chunkSignal('auth') })

    const held = channel.snapshot({ threadId: THREAD })
    expect(Object.isFrozen(held)).toBe(true)
    expect(channel.snapshot({ threadId: THREAD })).toBe(held)
    expect(held).toEqual([started, chunkSignal('auth')])
  })

  it('leaves nothing buffered once the step ends', () => {
    const { channel, open, receive } = harness()
    open()
    receive({ kind: EServeFrame.Signal, seq: 1, signal: started })
    receive({ kind: EServeFrame.Signal, seq: 2, signal: chunkSignal('auth') })

    receive({
      kind: EServeFrame.Signal,
      seq: 3,
      signal: { type: 'step-ended', stepId: STEP, end: EStepEnd.Completed, supersededBy: null },
    })

    expect(channel.snapshot({ threadId: THREAD })).toEqual([])
  })

  it('answers a foreign thread with an inert subscription, since one socket is one thread', () => {
    const { channel, open, receive } = harness()
    const { seen, listener } = recorder()
    channel.subscribe({ threadId: OTHER_THREAD, listener })
    open()

    receive({ kind: EServeFrame.Signal, seq: 1, signal: started })

    expect(seen).toEqual([])
    expect(channel.snapshot({ threadId: OTHER_THREAD })).toEqual([])
  })
})

describe('publishing into a remote channel', () => {
  it('is refused, because the sandbox owns the channel', () => {
    const { channel } = harness()

    expect(() => channel.publisherFor({ threadId: THREAD })).toThrow(RemotePublishRefused)
  })
})

describe('a gap the channel cannot replay', () => {
  it('surfaces reload rather than swallowing it', () => {
    const { channel, open, receive } = harness()
    const reloads: ChannelReload[] = []
    channel.onReload((reload) => void reloads.push(reload))
    open()

    receive({ kind: EServeFrame.Reload, sinceEventSeq: 31 })

    expect(reloads).toEqual([{ sinceEventSeq: 31 }])
  })

  it('ends the step in flight so no subscriber is left shimmering', () => {
    const { channel, open, receive } = harness()
    const { seen, listener } = recorder()
    channel.subscribe({ threadId: THREAD, listener })
    open()
    receive({ kind: EServeFrame.Signal, seq: 1, signal: started })
    receive({ kind: EServeFrame.Signal, seq: 2, signal: chunkSignal('auth') })

    receive({ kind: EServeFrame.Reload, sinceEventSeq: 31 })

    expect(seen.at(-1)).toEqual({
      type: 'step-ended',
      stepId: STEP,
      end: EStepEnd.Failed,
      supersededBy: null,
    })
    expect(channel.snapshot({ threadId: THREAD })).toEqual([])
  })

  it('drops the stale cursor, so the next hello asks for a fresh stream', () => {
    const { open, receive, drop, retries, live } = harness()
    open()
    receive({ kind: EServeFrame.Signal, seq: 9, signal: started })
    receive({ kind: EServeFrame.Reload, sinceEventSeq: 31 })

    drop()
    retries[0]?.run()
    live().handlers.handleOpen()

    expect(live().sent[0]).toMatchObject({ kind: EClientFrame.Hello, channelCursor: null })
  })
})

describe('losing the socket', () => {
  it('reconnects with backoff and resends hello carrying the last seq seen', () => {
    const { open, receive, drop, retries, sockets, live } = harness({ lastEventSeq: 7 })
    open()
    receive({ kind: EServeFrame.Ready, seq: 4 })
    receive({ kind: EServeFrame.Signal, seq: 5, signal: started })

    drop()
    expect(retries[0]?.delayMs).toBe(500)
    retries[0]?.run()
    live().handlers.handleOpen()

    expect(sockets).toHaveLength(2)
    expect(live().sent[0]).toEqual({
      kind: EClientFrame.Hello,
      threadId: THREAD,
      channelCursor: 5,
      lastEventSeq: 7,
    })
  })

  it('reports itself reconnecting while the socket is down', () => {
    const { channel, open, receive, drop } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })

    drop()

    expect(channel.connection().state).toBe(EChannelConnection.Reconnecting)
  })

  it('keeps the step in flight across a drop, so a quick resume is seamless', () => {
    const { channel, open, receive, drop } = harness()
    const { seen, listener } = recorder()
    channel.subscribe({ threadId: THREAD, listener })
    open()
    receive({ kind: EServeFrame.Signal, seq: 1, signal: started })

    drop()

    expect(seen).toEqual([started])
    expect(channel.snapshot({ threadId: THREAD })).toEqual([started])
  })

  it('ends the step in flight once the socket will not come back', () => {
    const { channel, open, receive, drop } = harness({ maxAttempts: 0 })
    const { seen, listener } = recorder()
    channel.subscribe({ threadId: THREAD, listener })
    open()
    receive({ kind: EServeFrame.Signal, seq: 1, signal: started })

    drop()

    expect(seen.at(-1)).toMatchObject({ type: 'step-ended', end: EStepEnd.Failed })
    expect(channel.connection().state).toBe(EChannelConnection.Closed)
  })
})

describe('a sandbox that parked', () => {
  it('is a state, not an error', () => {
    const { channel, open, receive } = harness()
    open()

    receive({ kind: EServeFrame.Parked, reason: 'idle past the ttl' })

    expect(channel.connection()).toEqual({
      state: EChannelConnection.Parked,
      detail: 'idle past the ttl',
    })
  })

  it('does not strand the step it parked in the middle of', () => {
    const { channel, open, receive } = harness()
    const { seen, listener } = recorder()
    channel.subscribe({ threadId: THREAD, listener })
    open()
    receive({ kind: EServeFrame.Signal, seq: 1, signal: started })

    receive({ kind: EServeFrame.Parked, reason: 'idle past the ttl' })

    expect(seen.at(-1)).toMatchObject({ type: 'step-ended', end: EStepEnd.Failed })
  })
})

describe('what the channel refuses to swallow', () => {
  it('surfaces a server error frame', () => {
    const { channel, open, receive } = harness()
    const messages: string[] = []
    channel.onError((failure) => void messages.push(failure.message))
    open()

    receive({ kind: EServeFrame.Error, message: 'the turn could not start' })

    expect(messages).toEqual(['the turn could not start'])
  })

  it('surfaces a frame it could not read rather than dropping it', () => {
    const { channel, open, live } = harness()
    const messages: string[] = []
    channel.onError((failure) => void messages.push(failure.message))
    open()

    live().handlers.handleMessage('{"kind":"nonsense"}')

    expect(messages).toHaveLength(1)
  })
})

describe('driving a turn over the wire', () => {
  it('sends a bare run frame, since what was said is already in the log', () => {
    const { channel, open, receive, live } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })

    channel.run()

    expect(live().sent).toEqual([
      { kind: EClientFrame.Hello, threadId: THREAD, channelCursor: null, lastEventSeq: 0 },
      { kind: EClientFrame.Run },
    ])
  })

  it('hands a turn outcome to its listeners as it arrives', () => {
    const { channel, open, receive } = harness()
    const outcomes: TurnOutcome[] = []
    channel.onTurnEnded((outcome) => void outcomes.push(outcome))
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })

    receive({
      kind: EServeFrame.TurnEnded,
      outcome: { status: ETurnStatus.Completed, runId: toRunId('run-1') },
    })

    expect(outcomes).toEqual([{ status: ETurnStatus.Completed, runId: toRunId('run-1') }])
  })
})

describe('waking a channel whose socket will not come back', () => {
  it('dials the fresh attachment and reports itself connecting', () => {
    const { channel, open, receive, drop, sockets, live } = harness({ maxAttempts: 0 })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    drop()
    expect(channel.connection().state).toBe(EChannelConnection.Closed)

    channel.wake({ url: 'https://fresh.test/', token: 'tok_fresh' })

    expect(sockets).toHaveLength(2)
    expect(live().url).toBe('wss://fresh.test/v1/session')
    expect(live().protocols).toEqual([CHANNEL_SUBPROTOCOL, bearerSubprotocolOf('tok_fresh')])
    expect(channel.connection().state).toBe(EChannelConnection.Connecting)

    live().handlers.handleOpen()
    live().handlers.handleMessage(encodeFrame({ kind: EServeFrame.Ready, seq: 1 }))
    expect(channel.connection().state).toBe(EChannelConnection.Open)
  })

  it('cancels the retry it had scheduled, so the old dial never lands', () => {
    const { channel, open, receive, drop, retries } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    drop()
    expect(retries).toHaveLength(1)

    channel.wake({ url: 'https://fresh.test/', token: 'tok_fresh' })
    retries[0]?.run()

    expect(channel.connection().state).toBe(EChannelConnection.Connecting)
  })

  it('flushes what was queued while it was closed once the fresh socket is ready', () => {
    const { channel, open, receive, drop, live } = harness({ maxAttempts: 0 })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    drop()

    channel.run()
    channel.wake({ url: 'https://fresh.test/', token: 'tok_fresh' })
    live().handlers.handleOpen()
    live().handlers.handleMessage(encodeFrame({ kind: EServeFrame.Ready, seq: 1 }))

    expect(live().sent.at(-1)).toEqual({ kind: EClientFrame.Run })
  })

  it('stays closed for good once close() has run, wake or not', () => {
    const { channel, open, receive, sockets } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    channel.close()

    channel.wake({ url: 'https://fresh.test/', token: 'tok_fresh' })

    expect(sockets).toHaveLength(1)
    expect(channel.connection().state).toBe(EChannelConnection.Closed)
  })
})

describe('closing the channel', () => {
  it('ends the step in flight, shuts the socket, and stops reconnecting', () => {
    const { channel, open, receive, live, retries } = harness()
    const { seen, listener } = recorder()
    channel.subscribe({ threadId: THREAD, listener })
    open()
    receive({ kind: EServeFrame.Signal, seq: 1, signal: started })

    const socket = live()
    channel.close()
    socket.handlers.handleClose()

    expect(seen.at(-1)).toMatchObject({ type: 'step-ended', end: EStepEnd.Failed })
    expect(socket.closed).toBe(true)
    expect(channel.connection().state).toBe(EChannelConnection.Closed)
    expect(retries).toEqual([])
  })
})
