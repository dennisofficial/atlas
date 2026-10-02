import { describe, expect, it } from 'bun:test'

import { toRunId } from '@dltech/atlas-core'

import { EStepEnd } from '../../channel/signal'
import { ETurnStatus, type TurnOutcome } from '../../loop/turn-outcome'
import {
  bearerSubprotocolOf,
  CHANNEL_PROTOCOL_VERSION,
  CHANNEL_SUBPROTOCOL,
  decodeClientFrame,
  EClientFrame,
  encodeFrame,
  EServeFrame,
  type ClientFrame,
  type ServeFrame,
} from '../channel-wire'
import {
  createRemoteDeltaChannel,
  EChannelConnection,
  RemotePublishRefused,
  STRANDED_STEP_END,
  type ChannelReload,
  type ChannelSocketHandlers,
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

type FakeSocket = {
  url: string
  protocols: readonly string[]
  handlers: ChannelSocketHandlers
  sent: ClientFrame[]
  closed: boolean
}

type Keepalive = { intervalMs: number; run: () => void }

/**
 * A local stand-in for the shared `harness()` fixture, threading the escalation-probe and
 * keepalive factory args the shared fixture does not carry.
 */
const wiredHarness = (options: {
  maxAttempts?: number | undefined
  maxReattachments?: number | undefined
  reattach?: (() => Promise<{ url: string; token: string }>) | undefined
  shouldEscalate?: (() => Promise<boolean>) | undefined
  keepaliveMs?: number | undefined
  scheduleKeepalive?: ((keepalive: Keepalive) => () => void) | undefined
} = {}) => {
  const sockets: FakeSocket[] = []
  const retries: { delayMs: number; run: () => void }[] = []

  const channel = createRemoteDeltaChannel({
    threadId: THREAD,
    url: 'https://sandbox.test/',
    token: 'tok_session',
    maxAttempts: options.maxAttempts,
    maxReattachments: options.maxReattachments,
    reattach: options.reattach,
    shouldEscalate: options.shouldEscalate,
    keepaliveMs: options.keepaliveMs,
    scheduleKeepalive: options.scheduleKeepalive,
    scheduleRetry: (retry) => void retries.push(retry),
    socketFactory: ({ url, protocols, handlers }) => {
      const fake: FakeSocket = { url, protocols, handlers, sent: [], closed: false }
      sockets.push(fake)
      return {
        send: (data) => {
          const frame = decodeClientFrame(data)
          if (frame === null) throw new Error(`unreadable client frame: ${data}`)
          fake.sent.push(frame)
        },
        close: () => void (fake.closed = true),
      }
    },
  })

  const live = (): FakeSocket => {
    const socket = sockets.at(-1)
    if (socket === undefined) throw new Error('no socket was opened')
    return socket
  }

  return {
    channel,
    sockets,
    retries,
    live,
    open: () => live().handlers.handleOpen(),
    receive: (frame: ServeFrame) => live().handlers.handleMessage(encodeFrame(frame)),
    drop: () => live().handlers.handleClose(),
  }
}

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
      protocol: CHANNEL_PROTOCOL_VERSION,
    })
  })

  it('opens as before against a serve too old to stamp its ready', () => {
    const { channel, open, receive } = harness()

    open()
    receive({ kind: EServeFrame.Ready, seq: 4 })

    expect(channel.connection().state).toBe(EChannelConnection.Open)
  })

  it('refuses a serve on a newer wire protocol, legibly and without reconnecting', () => {
    const { channel, open, receive, live, retries } = harness()
    const failures: string[] = []
    channel.onServerError((failure) => void failures.push(failure.message))

    open()
    receive({ kind: EServeFrame.Ready, seq: 4, protocol: CHANNEL_PROTOCOL_VERSION + 1 })

    expect(channel.connection().state).toBe(EChannelConnection.Closed)
    expect(channel.connection().detail).toContain('update Atlas')
    expect(failures[0]).toContain('update Atlas')
    expect(live().closed).toBe(true)
    expect(retries).toEqual([])
  })

  it('refuses a serve on an older wire protocol, pointing at a re-open that rebuilds it', () => {
    const { channel, open, receive } = harness()
    const failures: string[] = []
    channel.onServerError((failure) => void failures.push(failure.message))

    open()
    receive({ kind: EServeFrame.Ready, seq: 4, protocol: CHANNEL_PROTOCOL_VERSION - 1 })

    expect(channel.connection().state).toBe(EChannelConnection.Closed)
    expect(channel.connection().detail).toContain('re-open the conversation')
    expect(failures[0]).toContain('re-open the conversation')
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
      end: STRANDED_STEP_END,
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

  it('surfaces a signal seq that skips ahead of the cursor as a reload, never delivering it', () => {
    const { channel, open, receive } = harness({ lastEventSeq: 31 })
    const reloads: ChannelReload[] = []
    channel.onReload((reload) => void reloads.push(reload))
    const { seen, listener } = recorder()
    channel.subscribe({ threadId: THREAD, listener })
    open()
    receive({ kind: EServeFrame.Ready, seq: 4 })
    receive({ kind: EServeFrame.Signal, seq: 4, signal: started })
    receive({ kind: EServeFrame.Signal, seq: 5, signal: chunkSignal('auth') })

    receive({ kind: EServeFrame.Signal, seq: 9, signal: chunkSignal('and the router') })

    expect(seen).toEqual([
      started,
      chunkSignal('auth'),
      { type: 'step-ended', stepId: STEP, end: STRANDED_STEP_END, supersededBy: null },
    ])
    expect(reloads).toEqual([{ sinceEventSeq: 31 }])
    expect(channel.connection().state).toBe(EChannelConnection.Open)
  })

  it('resumes the delta stream where a gap reload leaves off, without redelivering', () => {
    const { channel, open, receive } = harness({ lastEventSeq: 31 })
    const reloads: ChannelReload[] = []
    channel.onReload((reload) => void reloads.push(reload))
    const { seen, listener } = recorder()
    channel.subscribe({ threadId: THREAD, listener })
    open()
    receive({ kind: EServeFrame.Ready, seq: 4 })
    receive({ kind: EServeFrame.Signal, seq: 4, signal: started })
    receive({ kind: EServeFrame.Signal, seq: 9, signal: chunkSignal('lost') })

    receive({ kind: EServeFrame.Signal, seq: 10, signal: chunkSignal('next') })

    expect(seen).toEqual([
      started,
      { type: 'step-ended', stepId: STEP, end: STRANDED_STEP_END, supersededBy: null },
      chunkSignal('next'),
    ])
    expect(reloads).toHaveLength(1)
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
      protocol: CHANNEL_PROTOCOL_VERSION,
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

    expect(seen.at(-1)).toMatchObject({ type: 'step-ended', end: STRANDED_STEP_END })
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

    expect(seen.at(-1)).toMatchObject({ type: 'step-ended', end: STRANDED_STEP_END })
  })

  it('stays parked when the socket closes behind the parked frame', () => {
    const { channel, open, receive, drop } = harness()
    open()
    receive({ kind: EServeFrame.Parked, reason: 'idle past the ttl' })

    drop()

    expect(channel.connection().state).toBe(EChannelConnection.Parked)
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
      {
        kind: EClientFrame.Hello,
        threadId: THREAD,
        channelCursor: null,
        lastEventSeq: 0,
        protocol: CHANNEL_PROTOCOL_VERSION,
      },
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

  it('hands a thread-renamed frame to its listeners with the thread id branded', () => {
    const { channel, open, receive } = harness()
    const renames: { threadId: string; title: string }[] = []
    channel.onThreadRenamed((renamed) => void renames.push(renamed))
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })

    receive({ kind: EServeFrame.ThreadRenamed, threadId: THREAD, title: 'a better name' })

    expect(renames).toEqual([{ threadId: THREAD, title: 'a better name' }])
  })

  it('hands a thread-model-changed frame to its listeners', () => {
    const { channel, open, receive } = harness()
    const changes: { threadId: string; model: { ref: string; effort: string } }[] = []
    channel.onThreadModelChanged((changed) => void changes.push(changed))
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })

    receive({
      kind: EServeFrame.ThreadModelChanged,
      threadId: THREAD,
      model: { ref: 'anthropic/claude-opus-5', effort: 'high' },
    })

    expect(changes).toEqual([
      { threadId: THREAD, model: { ref: 'anthropic/claude-opus-5', effort: 'high' } },
    ])
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

    expect(seen.at(-1)).toMatchObject({ type: 'step-ended', end: STRANDED_STEP_END })
    expect(socket.closed).toBe(true)
    expect(channel.connection().state).toBe(EChannelConnection.Closed)
    expect(retries).toEqual([])
  })
})

describe('a stale socket reaching back from an earlier generation', () => {
  it('ignores a close that arrives after a wake already replaced the socket', () => {
    const { channel, open, receive, sockets } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const stale = sockets[0]

    channel.wake({ url: 'https://fresh.test/', token: 'tok_fresh' })
    stale?.handlers.handleClose()

    expect(channel.connection().state).toBe(EChannelConnection.Connecting)
  })

  it('ignores a close that arrives after the channel was closed, so nothing reconnects', () => {
    const { channel, open, receive, sockets, retries } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const stale = sockets[0]

    channel.close()
    stale?.handlers.handleClose()

    expect(stale?.closed).toBe(true)
    expect(retries).toEqual([])
    expect(sockets).toHaveLength(1)
  })

  it('ignores an open from a socket a wake already replaced, so no hello leaks over it', () => {
    const { channel, open, receive, sockets, live } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    const stale = sockets[0]

    channel.wake({ url: 'https://fresh.test/', token: 'tok_fresh' })
    stale?.handlers.handleOpen()

    expect(stale?.sent).toHaveLength(1)
    live().handlers.handleOpen()
    expect(live().sent[0]?.kind).toBe(EClientFrame.Hello)
  })

  it('ignores a close from a superseded reconnect attempt, so the current socket stays put', () => {
    const { channel, open, receive, drop, retries, sockets, live } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    drop()

    retries[0]?.run()
    retries[0]?.run()

    expect(sockets).toHaveLength(2)
    expect(sockets[0]?.closed).toBe(true)
    live().handlers.handleOpen()
    live().handlers.handleMessage(encodeFrame({ kind: EServeFrame.Ready, seq: 1 }))
    expect(channel.connection().state).toBe(EChannelConnection.Open)
  })

  it('ignores a scheduled reconnect that fires after close() abandoned the channel', () => {
    const { channel, open, receive, drop, retries, sockets } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    drop()
    expect(retries).toHaveLength(1)

    channel.close()
    retries[0]?.run()

    expect(sockets).toHaveLength(1)
    expect(channel.connection().state).toBe(EChannelConnection.Closed)
  })
})

describe('probing for an early escalation', () => {
  const freshAttachment = { url: 'https://fresh.test/', token: 'tok_fresh' }

  it('asks once a retry cycle begins, and escalates right away when the answer is yes', async () => {
    const { channel, open, receive, drop, sockets, retries } = wiredHarness({
      shouldEscalate: () => Promise.resolve(true),
      reattach: () => Promise.resolve(freshAttachment),
    })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })

    drop()
    expect(channel.connection().state).toBe(EChannelConnection.Reconnecting)

    await Bun.sleep(1)

    expect(channel.connection().state).toBe(EChannelConnection.Connecting)
    expect(sockets).toHaveLength(2)

    retries[0]?.run()
    expect(sockets).toHaveLength(2)
  })

  it('treats a rejecting probe as a no, so the backoff still runs its course', async () => {
    let reattachCalls = 0
    const { channel, open, receive, drop, sockets } = wiredHarness({
      shouldEscalate: () => Promise.reject(new Error('probe unreachable')),
      reattach: () => {
        reattachCalls += 1
        return Promise.resolve(freshAttachment)
      },
    })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })

    drop()
    await Bun.sleep(1)

    expect(channel.connection().state).toBe(EChannelConnection.Reconnecting)
    expect(reattachCalls).toBe(0)
    expect(sockets).toHaveLength(1)
  })

  it('does not ask again later in the same retry cycle', () => {
    let probeCalls = 0
    const { open, receive, drop, retries, live } = wiredHarness({
      shouldEscalate: () => {
        probeCalls += 1
        return new Promise<boolean>(() => undefined)
      },
      reattach: () => Promise.resolve(freshAttachment),
    })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })

    drop()
    expect(probeCalls).toBe(1)

    retries[0]?.run()
    live().handlers.handleClose()

    expect(probeCalls).toBe(1)
  })

  it('asks again once a fresh retry cycle begins after a clean reconnect', () => {
    let probeCalls = 0
    const { open, receive, drop, retries, live } = wiredHarness({
      shouldEscalate: () => {
        probeCalls += 1
        return new Promise<boolean>(() => undefined)
      },
      reattach: () => Promise.resolve(freshAttachment),
    })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    drop()
    expect(probeCalls).toBe(1)

    retries[0]?.run()
    live().handlers.handleOpen()
    live().handlers.handleMessage(encodeFrame({ kind: EServeFrame.Ready, seq: 1 }))

    drop()
    expect(probeCalls).toBe(2)
  })

  it('never asks when there is no reattach to escalate into', () => {
    let probeCalls = 0
    const { open, receive, drop } = wiredHarness({
      shouldEscalate: () => {
        probeCalls += 1
        return Promise.resolve(true)
      },
    })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })

    drop()

    expect(probeCalls).toBe(0)
  })

  it('never asks once the re-attach budget is already spent', () => {
    let probeCalls = 0
    const { open, receive, drop } = wiredHarness({
      maxReattachments: 0,
      shouldEscalate: () => {
        probeCalls += 1
        return Promise.resolve(true)
      },
      reattach: () => Promise.resolve(freshAttachment),
    })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })

    drop()

    expect(probeCalls).toBe(0)
  })

  it('ignores a late yes once a wake already moved the channel on', async () => {
    let resolveProbe: (escalateNow: boolean) => void = () => undefined
    const { sockets, open, receive, drop, channel } = wiredHarness({
      shouldEscalate: () => new Promise<boolean>((resolve) => void (resolveProbe = resolve)),
      reattach: () => Promise.resolve(freshAttachment),
    })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    drop()

    channel.wake({ url: 'https://woken.test/', token: 'tok_woken' })
    resolveProbe(true)
    await Bun.sleep(1)

    expect(sockets.some((socket) => socket.url.includes('fresh'))).toBe(false)
    expect(channel.connection().state).toBe(EChannelConnection.Connecting)
  })

})

describe('the client-side keepalive', () => {
  it('starts sending pong frames once the socket opens, on the default interval', () => {
    const keepalives: Keepalive[] = []
    const { open, live } = wiredHarness({
      scheduleKeepalive: (keepalive) => {
        keepalives.push(keepalive)
        return () => undefined
      },
    })

    open()

    expect(keepalives).toHaveLength(1)
    expect(keepalives[0]?.intervalMs).toBe(30_000)

    keepalives[0]?.run()

    expect(live().sent.at(-1)).toEqual({ kind: EClientFrame.Pong })
  })

  it('honors a custom keepalive interval', () => {
    const keepalives: Keepalive[] = []
    const { open } = wiredHarness({
      keepaliveMs: 5_000,
      scheduleKeepalive: (keepalive) => {
        keepalives.push(keepalive)
        return () => undefined
      },
    })

    open()

    expect(keepalives[0]?.intervalMs).toBe(5_000)
  })

  it('stops the keepalive once the socket closes', () => {
    let stopped = false
    const { open, drop } = wiredHarness({
      scheduleKeepalive: () => () => void (stopped = true),
    })

    open()
    drop()

    expect(stopped).toBe(true)
  })

  it('stops the keepalive once the channel is closed', () => {
    let stopped = false
    const { channel, open } = wiredHarness({
      scheduleKeepalive: () => () => void (stopped = true),
    })

    open()
    channel.close()

    expect(stopped).toBe(true)
  })

  it('clears the old keepalive and starts a fresh one when a wake swaps the socket', () => {
    const stops: boolean[] = []
    const { channel, open, receive, live } = wiredHarness({
      scheduleKeepalive: () => {
        const index = stops.push(false) - 1
        return () => void (stops[index] = true)
      },
    })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    expect(stops).toEqual([false])

    channel.wake({ url: 'https://fresh.test/', token: 'tok_fresh' })
    expect(stops).toEqual([true])

    live().handlers.handleOpen()
    expect(stops).toEqual([true, false])
  })
})

describe('the sandbox pending queue, as the channel reports it', () => {
  const entries = [
    { id: 'pending-1', text: 'first', reserved: false },
    { id: 'pending-2', text: 'second', via: 'parent-agent', reserved: true },
  ]

  it('delivers a pending-changed signal to onPendingChanged listeners and holds it', () => {
    const { channel, open, receive } = harness()
    const heard: (readonly unknown[])[] = []
    channel.onPendingChanged((next) => void heard.push(next))
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    heard.length = 0

    receive({ kind: EServeFrame.Signal, seq: 2, signal: { type: 'pending-changed', entries } })

    expect(heard).toEqual([entries])
    expect(channel.pendingEntries()).toEqual(entries)
  })

  it('does not fold a pending-changed signal into the in-flight step', () => {
    const { channel, open, receive } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })

    receive({ kind: EServeFrame.Signal, seq: 2, signal: { type: 'pending-changed', entries } })

    expect(channel.snapshot({ threadId: THREAD })).toEqual([])
  })

  it('still hands the signal to ordinary channel listeners', () => {
    const { channel, open, receive } = harness()
    const { seen, listener } = recorder()
    channel.subscribe({ threadId: THREAD, listener })
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })

    receive({ kind: EServeFrame.Signal, seq: 2, signal: { type: 'pending-changed', entries } })

    expect(seen).toEqual([{ type: 'pending-changed', entries }])
  })

  it('clears the held queue on a fresh ready, before the serve sends its snapshot', () => {
    const { channel, open, receive } = harness()
    open()
    receive({ kind: EServeFrame.Ready, seq: 1 })
    receive({ kind: EServeFrame.Signal, seq: 2, signal: { type: 'pending-changed', entries } })
    expect(channel.pendingEntries()).toEqual(entries)

    const heard: (readonly unknown[])[] = []
    channel.onPendingChanged((next) => void heard.push(next))
    receive({ kind: EServeFrame.Ready, seq: 3 })

    expect(heard).toEqual([[]])
    expect(channel.pendingEntries()).toEqual([])

    receive({ kind: EServeFrame.Signal, seq: 3, signal: { type: 'pending-changed', entries } })
    expect(heard).toEqual([[], entries])
  })

  it('holds an empty queue before anything arrives', () => {
    expect(harness().channel.pendingEntries()).toEqual([])
  })
})
