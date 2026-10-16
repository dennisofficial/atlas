import { describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'
import {
  CHANNEL_PROTOCOL_VERSION,
  EClientFrame,
  EClientRequest,
  EServeFrame,
  ERotationPhase,
  encodeFrame,
  type RotationListener,
  type RotationOutcome,
  type RotationPort,
} from '@dltech/atlas-harness'

import { createFrameBuffer } from '../frame-buffer'
import { createSessionHandlers, type SessionSocket } from '../socket-session'
import type { ServeTurnDriver } from '../turn-driver'

const served = toThreadId('hello-served')
const stranger = toThreadId('hello-stranger')

const driver = {
  running: () => false,
  busy: () => false,
  outcomePending: () => false,
  settled: async () => undefined,
} as unknown as ServeTurnDriver

const rig = () => {
  const handlers = createSessionHandlers({
    threadId: served,
    buffer: createFrameBuffer({ capacity: 16 }),
    inFlight: () => [],
    liveStepId: () => null,
    driver,
    files: { list: async () => [] },
    refusal: () => null,
    log: () => undefined,
  })
  const sent: string[] = []
  let closed = false
  const socket = {
    data: { helloed: false, alias: null, greeting: 0, greeted: false, held: [], bootHeld: [] },
    send: (payload: string) => void sent.push(payload),
    close: () => {
      closed = true
    },
    terminate: () => undefined,
  } as unknown as SessionSocket
  handlers.open({ socket })
  const hello = async (args: { threadId: typeof served; protocol?: number }) => {
    handlers.message({
      socket,
      message: encodeFrame({
        kind: EClientFrame.Hello,
        threadId: args.threadId,
        channelCursor: null,
        lastEventSeq: 0,
        ...(args.protocol === undefined ? {} : { protocol: args.protocol }),
      }),
    })
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve()
    await Bun.sleep(0)
  }
  const kinds = () => sent.map((payload) => (JSON.parse(payload) as { kind: string }).kind)
  return { handlers, socket, hello, kinds, sent, closed: () => closed }
}

describe('hello admission', () => {
  it('closes the mutation gate from the lifecycle record, not a flag', async () => {
    const { handlers, socket, hello, sent } = rig()
    await hello({ threadId: served })
    let closed = false
    const gated = createSessionHandlers({
      threadId: served,
      buffer: createFrameBuffer({ capacity: 16 }),
      inFlight: () => [],
      liveStepId: () => null,
      driver,
      files: { list: async () => [] },
      refusal: () => null,
      log: () => undefined,
      admissionClosed: () => closed,
    })
    const gatedSent: string[] = []
    const gatedSocket = {
      data: { helloed: true, alias: null, greeting: 0, greeted: true, held: [], bootHeld: [] },
      send: (payload: string) => void gatedSent.push(payload),
      close: () => undefined,
      terminate: () => undefined,
    } as unknown as SessionSocket
    gated.open({ socket: gatedSocket })
    gated.message({ socket: gatedSocket, message: encodeFrame({ kind: EClientFrame.Run, resume: true }) })
    closed = true
    gated.message({ socket: gatedSocket, message: encodeFrame({ kind: EClientFrame.Run, resume: true }) })
    await Bun.sleep(0)
    expect(gatedSent.join()).toContain('parking and accepts no new work')
  })

  it('admits the served thread', async () => {
    const { hello, kinds } = rig()
    await hello({ threadId: served })
    expect(kinds()).toContain(EServeFrame.Ready)
  })

  it('refuses a thread the serve does not serve', async () => {
    const { hello, kinds, closed } = rig()
    await hello({ threadId: stranger })
    expect(kinds()).not.toContain(EServeFrame.Ready)
    expect(closed()).toBe(true)
  })

  it('still refuses a protocol mismatch', async () => {
    const { hello, sent, closed } = rig()
    await hello({ threadId: served, protocol: CHANNEL_PROTOCOL_VERSION + 1 })
    expect(closed()).toBe(true)
    expect(sent.join()).toContain('newer wire protocol')
  })

  it('repaints an in-flight rotation to a reattaching client right after Ready', async () => {
    const listeners = new Set<RotationListener>()
    const rotation = {
      request: () => new Promise<RotationOutcome>(() => undefined),
      subscribe: (listener: RotationListener) => {
        listeners.add(listener)
        return () => void listeners.delete(listener)
      },
    } as unknown as RotationPort
    const handlers = createSessionHandlers({
      threadId: served,
      buffer: createFrameBuffer({ capacity: 16 }),
      inFlight: () => [],
      liveStepId: () => null,
      driver: {
        ...driver,
        holdForRotation: () => () => undefined,
        beginRotation: () => ({ pause: () => undefined, waitSettled: async () => null }),
      } as unknown as ServeTurnDriver,
      files: { list: async () => [] },
      refusal: () => null,
      log: () => undefined,
      rotation,
    })
    const attach = async () => {
      const sent: string[] = []
      const socket = {
        data: { helloed: false, alias: null, greeting: 0, greeted: false, held: [], bootHeld: [] },
        send: (payload: string) => void sent.push(payload),
        close: () => undefined,
        terminate: () => undefined,
      } as unknown as SessionSocket
      handlers.open({ socket })
      handlers.message({
        socket,
        message: encodeFrame({ kind: EClientFrame.Hello, threadId: served, channelCursor: null, lastEventSeq: 0 }),
      })
      await Bun.sleep(0)
      return { socket, sent }
    }
    const first = await attach()
    handlers.message({
      socket: first.socket,
      message: encodeFrame({
        kind: EClientFrame.Request,
        id: 'r1',
        op: EClientRequest.Rotate,
        params: { threadId: served, operationId: 'op-1' },
      }),
    })
    await Bun.sleep(0)
    for (const listener of listeners)
      listener({ sessionId: served, operationId: 'op-1', phase: ERotationPhase.Settling })
    await Bun.sleep(0)

    const second = await attach()
    const frames = second.sent.map((payload) => JSON.parse(payload) as { kind: string; signal?: { type: string } })
    const ready = frames.findIndex((frame) => frame.kind === EServeFrame.Ready)
    const repaint = frames.findIndex((frame) => frame.signal?.type === 'rotation-changed')
    expect(ready).toBeGreaterThanOrEqual(0)
    expect(repaint).toBeGreaterThan(ready)
  })
})
