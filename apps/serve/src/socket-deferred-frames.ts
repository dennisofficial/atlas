import { EClientFrame, type ClientFrame, type ServeFrame } from '@dltech/atlas-harness'

import { refusedRequest } from './requests'
import { EServeEvent, type ServeLog } from './serve-log'
import type { SessionSocket } from './socket-session-types'
import { isReadOnlyFrame } from './socket-state-requests'

export const BETWEEN_PHASES_REFUSAL =
  'the sandbox is between lifecycle phases; retry once it is serving'

type Driven = { socket: SessionSocket; frame: ClientFrame }

const isDeferrable = (frame: ClientFrame): boolean =>
  frame.kind === EClientFrame.Send || frame.kind === EClientFrame.Run

const passesClosedAdmission = (frame: ClientFrame): boolean =>
  frame.kind === EClientFrame.Pong || isReadOnlyFrame(frame)

export function createDeferredFrames(args: {
  admissionClosed: (() => boolean) | undefined
  send: (sent: { socket: SessionSocket; frame: ServeFrame }) => void
  drive: (driven: Driven) => void
  log: ServeLog
}) {
  const { send, log } = args
  const held = new Map<SessionSocket, ClientFrame[]>()
  const closed = (): boolean => args.admissionClosed?.() === true

  const replaySocket = (socket: SessionSocket): void => {
    const frames = held.get(socket)
    if (frames === undefined) return
    held.delete(socket)
    log({ event: EServeEvent.AdmissionReplayed, frames: frames.length })
    for (const frame of frames) args.drive({ socket, frame })
  }

  const hold = ({ socket, frame }: Driven): void => {
    const frames = held.get(socket) ?? []
    frames.push(frame)
    held.set(socket, frames)
    log({ event: EServeEvent.AdmissionDeferred, frame: frame.kind, held: frames.length })
  }

  const turnAway = ({ socket, frame }: Driven): void => {
    if (frame.kind !== EClientFrame.Request) {
      log({ event: EServeEvent.AdmissionDropped, frame: frame.kind, reason: 'admission closed' })
      return
    }
    send({ socket, frame: refusedRequest({ replyTo: frame.id, message: BETWEEN_PHASES_REFUSAL }) })
    log({ event: EServeEvent.ClientRefused, reason: BETWEEN_PHASES_REFUSAL, op: frame.op })
  }

  return {
    admits: (driven: Driven): boolean => {
      if (!closed()) {
        replaySocket(driven.socket)
        return true
      }
      if (passesClosedAdmission(driven.frame)) return true
      if (isDeferrable(driven.frame)) hold(driven)
      else turnAway(driven)
      return false
    },

    replay: (): void => {
      if (closed()) return
      for (const socket of [...held.keys()]) replaySocket(socket)
    },

    drop: ({ socket }: { socket: SessionSocket }): void => {
      const frames = held.get(socket)
      if (frames === undefined) return
      held.delete(socket)
      log({ event: EServeEvent.AdmissionDropped, frames: frames.length, reason: 'socket closed' })
    },

    clear: (): void => held.clear(),
  }
}
