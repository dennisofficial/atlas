import { describe, expect, it } from 'bun:test'

import { EClientFrame, EClientRequest, EServeFrame, encodeFrame } from '@dltech/atlas-harness'
import { EPullRequestStateWire, type PrStateWire } from '@dltech/atlas-wire'
import type { ThreadId } from '@dltech/atlas-core'

import { createFrameBuffer } from '../frame-buffer'
import { createSessionHandlers, type SessionSocket } from '../socket-session'
import type { ServePrStates } from '../serve-app'
import type { ServeTurnDriver } from '../turn-driver'

const threadId = 'br_pr' as ThreadId

const aState = (args?: { number?: number }): PrStateWire => ({
  repo: 'github.com/dltech/atlas',
  number: args?.number ?? 1024,
  url: `https://github.com/dltech/atlas/pull/${args?.number ?? 1024}`,
  branch: 'dennis/pr-state',
  state: EPullRequestStateWire.Open,
  checksRunning: 2,
  checksPassed: 3,
  checksFailed: 0,
  mergeable: null,
})

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
    data: { helloed: false, alias: null },
    send: (payload: string) => {
      sent.push(payload)
    },
    close: () => undefined,
    terminate: () => undefined,
  } as unknown as SessionSocket
  return { socket, sent }
}

const hello = (socket: SessionSocket, handlers: ReturnType<typeof handlersFor>): void => {
  handlers.message({
    socket,
    message: encodeFrame({ kind: EClientFrame.Hello, threadId, channelCursor: null, lastEventSeq: 0 }),
  })
}

const handlersFor = (args?: { prStates?: ServePrStates }) =>
  createSessionHandlers({
    threadId,
    buffer: createFrameBuffer({ capacity: 16 }),
    inFlight: () => [],
    liveStepId: () => null,
    driver: untouchedDriver(),
    files: { list: async () => [] },
    refusal: () => null,
    log: () => undefined,
    ...(args?.prStates === undefined ? {} : { prStates: args.prStates }),
  })

const scriptedPrStates = (snapshot: readonly PrStateWire[]): ServePrStates => ({
  snapshot: () => snapshot,
  subscribe: () => () => undefined,
})

describe('the serve channel pull request states', () => {
  it('answers list-pr-states with the plugin snapshot', () => {
    const handlers = handlersFor({ prStates: scriptedPrStates([aState()]) })
    const { socket, sent } = freshSocket()
    hello(socket, handlers)
    sent.length = 0

    handlers.message({
      socket,
      message: encodeFrame({ kind: EClientFrame.Request, id: 'req-1', op: EClientRequest.ListPrStates, params: {} }),
    })

    expect(sent).toHaveLength(1)
    const reply = JSON.parse(sent[0] ?? '{}') as { kind: string; ok: boolean; data: { states: PrStateWire[] } }
    expect(reply.kind).toBe(EServeFrame.Reply)
    expect(reply.ok).toBe(true)
    expect(reply.data.states).toHaveLength(1)
    expect(reply.data.states[0]?.number).toBe(1024)
  })

  it('answers an empty set when no github plugin is composed', () => {
    const handlers = handlersFor()
    const { socket, sent } = freshSocket()
    hello(socket, handlers)
    sent.length = 0

    handlers.message({
      socket,
      message: encodeFrame({ kind: EClientFrame.Request, id: 'req-1', op: EClientRequest.ListPrStates, params: {} }),
    })

    const reply = JSON.parse(sent[0] ?? '{}') as { kind: string; data: { states: PrStateWire[] } }
    expect(reply.kind).toBe(EServeFrame.Reply)
    expect(reply.data.states).toEqual([])
  })

  it('broadcasts the current set to attached clients', () => {
    const handlers = handlersFor({ prStates: scriptedPrStates([aState({ number: 2048 })]) })
    const { socket, sent } = freshSocket()
    hello(socket, handlers)
    sent.length = 0

    handlers.broadcastPrStates()

    expect(sent).toHaveLength(1)
    const frame = JSON.parse(sent[0] ?? '{}') as { kind: string; states: PrStateWire[] }
    expect(frame.kind).toBe(EServeFrame.PrStates)
    expect(frame.states[0]?.number).toBe(2048)
  })
})
