import { CHANNEL_PROTOCOL_VERSION, EServeFrame, type ServeFrame } from '@dltech/atlas-harness'
import type { ThreadId } from '@dltech/atlas-core'

import { pendingEntriesOf } from './requests'
import { operatorInputSnapshot } from './operator-input'
import { EServeEvent, type ServeLog } from './serve-log'
import type { FrameBuffer, SignalFrame } from './frame-buffer'
import type { HelloFrame, SessionHandlersArgs, SessionSocket } from './socket-session-types'
import type { createStepAliaser } from './step-alias'

export function createSocketGreeter(args: {
  threadId: ThreadId
  buffer: FrameBuffer
  inFlight: () => readonly SignalFrame[]
  liveStepId: SessionHandlersArgs['liveStepId']
  driver: SessionHandlersArgs['driver']
  pending: SessionHandlersArgs['pending']
  operatorInput: SessionHandlersArgs['operatorInput']
  checkpointField: () => { checkpoint?: import('@dltech/atlas-wire').RuntimeCheckpoint }
  historyGeneration: () => number
  refusal: () => string | null
  aliaser: ReturnType<typeof createStepAliaser>
  attached: Set<SessionSocket>
  send: (args: { socket: SessionSocket; frame: ServeFrame }) => void
  forSocket: (args: { socket: SessionSocket; frame: ServeFrame }) => ServeFrame
  drive: (args: { socket: SessionSocket; frame: import('@dltech/atlas-harness').ClientFrame }) => void
  log: ServeLog
}) {
  const { threadId, buffer, inFlight, liveStepId, driver, pending, operatorInput, send, log } = args
  return (greeting: { socket: SessionSocket; hello: HelloFrame; head: number | null }): void => {
    const { socket, hello, head } = greeting
    const cursor = hello.channelCursor
    const resumed = cursor !== null && buffer.holds(cursor)
    if (!resumed) send({ socket, frame: { kind: EServeFrame.Reload, sinceEventSeq: hello.lastEventSeq } })
    const backfill = resumed && cursor !== null ? buffer.after(cursor) : inFlight()
    const rewritten =
      (!resumed && args.historyGeneration() > 0) || backfill.some((frame) => frame.kind === EServeFrame.Reload)
    send({
      socket,
      frame: {
        kind: EServeFrame.Ready,
        seq: buffer.nextSeq(),
        protocol: CHANNEL_PROTOCOL_VERSION,
        turnInFlight: driver.outcomePending(),
        ...(head === null ? {} : { transcriptCurrent: head === hello.lastEventSeq && !rewritten }),
        ...args.checkpointField(),
      },
    })
    const blocked = args.refusal()
    if (blocked !== null) send({ socket, frame: { kind: EServeFrame.Error, message: blocked } })
    const queued = pending === undefined ? [] : pendingEntriesOf({ pending, threadId })
    if (queued.length > 0)
      send({
        socket,
        frame: {
          kind: EServeFrame.Signal,
          seq: Math.max(0, buffer.nextSeq() - 1),
          signal: { type: 'pending-changed', entries: queued },
        },
      })
    const reloadedMidStep = resumed ? null : liveStepId()
    socket.data.alias = reloadedMidStep === null ? null : args.aliaser.next(reloadedMidStep)
    for (const frame of backfill) send({ socket, frame: args.forSocket({ socket, frame }) })
    if (operatorInput !== undefined)
      send({ socket, frame: operatorInputSnapshot({ operatorInput, threadId, seq: buffer.nextSeq() }) })
    args.attached.add(socket)
    socket.data.greeted = true
    for (const frame of socket.data.held.splice(0)) args.drive({ socket, frame })
    log({
      event: EServeEvent.ClientAttached,
      resumed,
      cursor,
      backfilled: backfill.length,
      clients: args.attached.size,
    })
  }
}
