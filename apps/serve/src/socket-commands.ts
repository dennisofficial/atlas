import { eventBodySchema, type EventDraft, type ThreadId } from '@dltech/atlas-core'
import { EClientFrame, EServeFrame, type ClientFrame, type ServeFrame } from '@dltech/atlas-harness'

import type { FrameBuffer } from './frame-buffer'
import { EServeEvent, type ServeLog } from './serve-log'
import { messageOf } from './message-of'
import type { SessionSocket } from './socket-session'
import type { ServeTurnDriver } from './turn-driver'

export function createTurnCommands(args: {
  threadId: ThreadId
  driver: ServeTurnDriver
  buffer: Pick<FrameBuffer, 'nextSeq'>
  log: ServeLog
  send: (args: { socket: SessionSocket; frame: ServeFrame }) => void
}) {
  const { threadId, driver, buffer, log, send } = args
  const committedSends = new Set<string>()

  return (commanded: { socket: SessionSocket; frame: ClientFrame }): void => {
    const { socket, frame } = commanded
    if (frame.kind === EClientFrame.Send) {
      let context: EventDraft[] | undefined
      try {
        context = frame.context?.map((draft): EventDraft => eventBodySchema.parse(draft))
      } catch {
        send({
          socket,
          frame: { kind: EServeFrame.Error, message: 'a context draft was not an event body' },
        })
        return
      }
      if (committedSends.has(frame.sendId)) {
        send({ socket, frame: { kind: EServeFrame.SendAcked, sendId: frame.sendId } })
        return
      }
      void driver
        .say({
          text: frame.text,
          ...(frame.requestId === undefined ? {} : { requestId: frame.requestId }),
          images: frame.images,
          files: frame.files,
          uploads: frame.uploads,
          ...(context === undefined ? {} : { context }),
        })
        .then(() => {
          committedSends.add(frame.sendId)
          send({ socket, frame: { kind: EServeFrame.SendAcked, sendId: frame.sendId } })
        })
        .catch((error: unknown) => {
          const message = messageOf(error, 'the message was not accepted')
          send({ socket, frame: { kind: EServeFrame.Error, message } })
        })
      return
    }

    if (frame.kind === EClientFrame.Run) {
      try {
        driver.run({ resume: frame.resume === true, onlyIfIdle: true })
      } catch (error) {
        send({
          socket,
          frame: {
            kind: EServeFrame.Error,
            message: messageOf(error, 'the turn was not accepted'),
          },
        })
      }
      return
    }

    if (frame.kind === EClientFrame.Interrupt) {
      log({
        event: EServeEvent.InterruptRequested,
        threadId,
        actor: 'client',
        running: driver.running(),
      })
      driver.interrupt()
      send({ socket, frame: { kind: EServeFrame.InterruptAcked, seq: buffer.nextSeq() } })
      return
    }

    if (frame.kind === EClientFrame.DismissFailure) {
      void driver.dismissFailure({ failureSeq: frame.failureSeq }).catch((error: unknown) => {
        send({
          socket,
          frame: {
            kind: EServeFrame.Error,
            message: messageOf(error, 'the failure was not dismissed'),
          },
        })
      })
      return
    }

    if (frame.kind === EClientFrame.Pause) {
      void (async () => driver.beginRelocation())().catch((error: unknown) => {
        send({
          socket,
          frame: {
            kind: EServeFrame.Error,
            message: messageOf(error, 'the session could not pause for the workspace handoff'),
          },
        })
      })
      return
    }

    if (frame.kind === EClientFrame.Resume) {
      driver.resume()
      return
    }

    if (frame.kind === EClientFrame.Settings) {
      log({
        event: EServeEvent.SettingsDropped,
        reason: 'settings come from Atlas Cloud; a client settings frame is ignored',
      })
      return
    }
  }
}
