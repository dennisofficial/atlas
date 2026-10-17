import { describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'
import { ERuntimePhase, admissionClosedFor, runtimeCheckpointSchema, type RuntimeCheckpoint } from '@dltech/atlas-wire'
import { EClientFrame, EClientRequest, EServeFrame, encodeFrame, toSendId, type ClientFrame } from '@dltech/atlas-harness'

import { createFrameBuffer } from '../frame-buffer'
import { EServeEvent, type ServeLogLine } from '../serve-log'
import { BETWEEN_PHASES_REFUSAL } from '../socket-deferred-frames'
import { createSessionHandlers, type SessionSocket } from '../socket-session'
import type { ServeTurnDriver } from '../turn-driver'

const threadId = toThreadId('admission-deferral')

const checkpointAt = (phase: ERuntimePhase): RuntimeCheckpoint =>
  runtimeCheckpointSchema.parse({
    threadId: String(threadId), runtimeId: 'runtime', sandboxSessionId: 'session',
    revision: 1, phase, reportedAt: '2026-10-16T00:00:00.000Z',
    transcript: { head: 1, count: 1, digest: 'a'.repeat(64) },
  })

const greetedSocket = () => {
  const sent: string[] = []
  const socket = {
    data: { helloed: true, alias: null, greeting: 0, greeted: true, held: [], bootHeld: [] },
    send: (payload: string) => void sent.push(payload),
    close: () => undefined,
    terminate: () => undefined,
  } as unknown as SessionSocket
  const frames = () => sent.map((payload) => JSON.parse(payload) as { kind: string; [field: string]: unknown })
  return { socket, frames }
}

const rig = () => {
  let current: RuntimeCheckpoint | null = checkpointAt(ERuntimePhase.Parking)
  const said: string[] = []
  const logged: ServeLogLine[] = []
  const driver = {
    say: async (given: { text: string }) => void said.push(given.text),
    run: () => undefined,
    running: () => false,
    busy: () => false,
    outcomePending: () => false,
    settled: async () => undefined,
  } as unknown as ServeTurnDriver
  const handlers = createSessionHandlers({
    threadId,
    buffer: createFrameBuffer({ capacity: 16 }),
    inFlight: () => [],
    liveStepId: () => null,
    driver,
    files: { list: async () => [] },
    refusal: () => null,
    admissionClosed: () => current !== null && admissionClosedFor(current.phase),
    checkpoint: () => current,
    log: (line) => void logged.push(line),
  })
  const deliver = (args: { socket: SessionSocket; frame: ClientFrame }): void => {
    handlers.message({ socket: args.socket, message: encodeFrame(args.frame) })
  }
  const moveTo = (phase: ERuntimePhase): void => {
    current = checkpointAt(phase)
    handlers.broadcast({ kind: EServeFrame.Checkpoint, checkpoint: current })
  }
  return { handlers, said, logged, deliver, moveTo }
}

const sendFrame = (sendId: string): ClientFrame => ({ kind: EClientFrame.Send, sendId: toSendId(sendId), text: sendId })

const settle = async (): Promise<void> => {
  for (let tick = 0; tick < 4; tick += 1) await Promise.resolve()
  await Bun.sleep(0)
}

describe('serve admission while between lifecycle phases', () => {
  it('holds a Send without an ack or an error, then drives and acks it once the record is Serving again', async () => {
    const { handlers, said, logged, deliver, moveTo } = rig()
    const { socket, frames } = greetedSocket()
    handlers.open({ socket })

    deliver({ socket, frame: sendFrame('first') })
    deliver({ socket, frame: sendFrame('second') })
    await settle()
    expect(said).toEqual([])
    expect(frames()).toEqual([])
    expect(logged.map((line) => line.event)).toEqual([EServeEvent.AdmissionDeferred, EServeEvent.AdmissionDeferred])

    moveTo(ERuntimePhase.Serving)
    await settle()
    expect(said).toEqual(['first', 'second'])
    const acked = frames().filter((frame) => frame.kind === EServeFrame.SendAcked).map((frame) => frame['sendId'])
    expect(acked).toEqual(['first', 'second'])
    expect(frames().some((frame) => frame.kind === EServeFrame.Error)).toBe(false)
  })

  it('keeps holding while the record stays closed and drops the held frames when the socket closes', async () => {
    const { handlers, said, logged, deliver, moveTo } = rig()
    const { socket, frames } = greetedSocket()
    handlers.open({ socket })

    deliver({ socket, frame: sendFrame('held') })
    moveTo(ERuntimePhase.Parked)
    await settle()
    expect(said).toEqual([])

    handlers.close({ socket })
    moveTo(ERuntimePhase.Serving)
    await settle()
    expect(said).toEqual([])
    expect(frames().some((frame) => frame.kind === EServeFrame.SendAcked)).toBe(false)
    expect(logged.some((line) => line.event === EServeEvent.AdmissionDropped && line['reason'] === 'socket closed')).toBe(true)
  })

  it('answers a mutating Request with a refused Reply, never an Error frame', async () => {
    const { handlers, deliver } = rig()
    const { socket, frames } = greetedSocket()
    handlers.open({ socket })

    deliver({
      socket,
      frame: { kind: EClientFrame.Request, id: 'ren-1', op: EClientRequest.RenameThread, params: { threadId, title: 'x' } },
    })
    await settle()

    expect(frames()).toEqual([
      { kind: EServeFrame.Reply, replyTo: 'ren-1', ok: false, data: { message: BETWEEN_PHASES_REFUSAL } },
    ])
  })

  it('still answers a read-only Request while closed', async () => {
    const { handlers, deliver } = rig()
    const { socket, frames } = greetedSocket()
    handlers.open({ socket })

    deliver({ socket, frame: { kind: EClientFrame.Request, id: 'cp-1', op: EClientRequest.ReadRuntimeCheckpoint, params: {} } })
    await settle()

    const reply = frames()[0]
    expect(reply?.kind).toBe(EServeFrame.Reply)
    expect(reply?.['ok']).toBe(true)
  })
})
