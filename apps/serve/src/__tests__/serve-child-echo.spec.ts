import { describe, expect, it } from 'bun:test'

import { toThreadId, type ThreadId } from '@dltech/atlas-core'
import { EClientFrame, encodeFrame, type ChannelSignal } from '@dltech/atlas-harness'

import { createFrameBuffer } from '../frame-buffer'
import { createSessionHandlers, type SessionSocket } from '../socket-session'
import type { ServeTurnDriver } from '../turn-driver'
import { refusedFile } from './fakes'

const root = toThreadId('brn_root')
const teammate = toThreadId('brn_teammate')

const untouchedDriver = (): ServeTurnDriver =>
  ({
    running: () => false,
    busy: () => false,
    outcomePending: () => false,
    settled: async () => undefined,
  }) as unknown as ServeTurnDriver

const freshSocket = (): { socket: SessionSocket; sent: string[] } => {
  const sent: string[] = []
  const socket = {
    data: { helloed: false, alias: null, greeting: 0, greeted: false, held: [], bootHeld: [] },
    send: (payload: string) => {
      sent.push(payload)
    },
    close: () => undefined,
    terminate: () => undefined,
  } as unknown as SessionSocket
  return { socket, sent }
}

const signalsOf = (sent: readonly string[]): Record<string, unknown>[] =>
  sent
    .map((payload) => JSON.parse(payload) as { kind: string; signal?: Record<string, unknown> })
    .flatMap((frame) =>
      frame.kind === 'signal' && frame.signal !== undefined ? [frame.signal] : [],
    )

type ChannelStub = {
  subscribe: (args: { threadId: ThreadId; listener: (signal: ChannelSignal) => void }) => () => void
  emit: (threadId: ThreadId, signal: ChannelSignal) => void
  subscribed: () => ThreadId[]
}

const channelStub = (): ChannelStub => {
  const listeners = new Map<ThreadId, Set<(signal: ChannelSignal) => void>>()
  return {
    subscribe: ({ threadId, listener }) => {
      let held = listeners.get(threadId)
      if (held === undefined) {
        held = new Set()
        listeners.set(threadId, held)
      }
      held.add(listener)
      return () => {
        held.delete(listener)
        if (held.size === 0) listeners.delete(threadId)
      }
    },
    emit: (threadId, signal) => {
      for (const listener of [...(listeners.get(threadId) ?? [])]) listener(signal)
    },
    subscribed: () => [...listeners.keys()],
  }
}

const handlersFor = (args: { channel: ChannelStub }) =>
  createSessionHandlers({
    activity: {
      read: async () => {
        throw new Error('activity is not initialized')
      },
    },
    channel: args.channel,
    threadId: root,
    admitsThread: async (threadId) => threadId === teammate,
    buffer: createFrameBuffer({ capacity: 16 }),
    inFlight: () => [],
    liveStepId: () => null,
    driver: untouchedDriver(),
    files: {
      list: async () => [],
      read: async () => refusedFile,
      search: async () => ({ paths: [], truncated: false }),
    },
    refusal: () => null,
    log: () => undefined,
  })

const hello = async (
  socket: SessionSocket,
  handlers: ReturnType<typeof handlersFor>,
  threadId: ThreadId,
): Promise<void> => {
  handlers.open({ socket })
  handlers.message({
    socket,
    message: encodeFrame({
      kind: EClientFrame.Hello,
      threadId,
      channelCursor: null,
      lastEventSeq: 0,
    }),
  })
  for (let flush = 0; flush < 8; flush += 1) await Promise.resolve()
}

describe('the socket echo of a viewed teammate thread', () => {
  it('ignores a hello at the root thread itself', async () => {
    const channel = channelStub()
    const handlers = handlersFor({ channel })
    const { socket } = freshSocket()
    await hello(socket, handlers, root)

    expect(channel.subscribed()).toEqual([])
  })

  it('seqs an echo below the next buffered frame, like the greeter snapshots', async () => {
    const channel = channelStub()
    const handlers = handlersFor({ channel })
    const { socket, sent } = freshSocket()
    await hello(socket, handlers, teammate)

    channel.emit(teammate, { type: 'events-appended' })

    const echoes = sent
      .map((payload) => JSON.parse(payload) as { kind: string; seq?: number })
      .filter((frame) => frame.kind === 'signal')
    expect(echoes.length).toBeGreaterThan(0)
    for (const frame of echoes) expect(frame.seq).toBe(0)
  })

  it("echoes the teammate thread's scoped signals to its viewer, tagged with the thread", async () => {
    const channel = channelStub()
    const handlers = handlersFor({ channel })
    const { socket, sent } = freshSocket()
    await hello(socket, handlers, teammate)

    expect(channel.subscribed()).toEqual([teammate])

    channel.emit(teammate, { type: 'turn-working', working: true })
    channel.emit(teammate, { type: 'events-appended' })
    channel.emit(root, { type: 'events-appended' })

    expect(signalsOf(sent)).toEqual([
      { type: 'turn-working', working: true, threadId: teammate },
      { type: 'events-appended', threadId: teammate },
    ])
  })

  it("never echoes a thread's signals to a socket viewing another thread", async () => {
    const channel = channelStub()
    const handlers = handlersFor({ channel })
    const rootViewer = freshSocket()
    const teammateViewer = freshSocket()
    await hello(rootViewer.socket, handlers, root)
    await hello(teammateViewer.socket, handlers, teammate)

    expect(channel.subscribed()).toEqual([teammate])

    channel.emit(teammate, { type: 'pending-changed', entries: [] })

    expect(signalsOf(rootViewer.sent)).toEqual([])
    expect(signalsOf(teammateViewer.sent)).toEqual([
      { type: 'pending-changed', entries: [], threadId: teammate },
    ])
  })

  it("drops the thread's echo once its last viewer leaves", async () => {
    const channel = channelStub()
    const handlers = handlersFor({ channel })
    const { socket } = freshSocket()
    await hello(socket, handlers, teammate)
    expect(channel.subscribed()).toEqual([teammate])

    handlers.close({ socket })

    channel.emit(teammate, { type: 'events-appended' })
    expect(channel.subscribed()).toEqual([])
  })
})
