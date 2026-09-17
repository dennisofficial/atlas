import type { ServerWebSocket } from 'bun'

import type { ThreadId } from '@dltech/atlas-core'

import type { StepId } from '../channel/signal'

import {
  EClientFrame,
  EServeFrame,
  decodeClientFrame,
  encodeFrame,
  type ClientFrame,
  type ServeFrame,
} from '../cloud/channel-wire'
import type { FileBrowser } from '../files/file-browser'

import type { FrameBuffer, SignalFrame } from './frame-buffer'
import { answerRequest } from './requests'
import { EServeEvent, type ServeLog } from './serve-log'
import { createStepAliaser, endsAliasedStep, retagged, type StepAlias } from './step-alias'
import type { ServeTurnDriver } from './turn-driver'

const POLICY_VIOLATION = 1008

export type SocketState = { helloed: boolean; alias: StepAlias | null }

export type SessionSocket = ServerWebSocket<SocketState>

export type SessionHandlers = {
  open: (args: { socket: SessionSocket }) => void
  message: (args: { socket: SessionSocket; message: string | Buffer }) => void
  close: (args: { socket: SessionSocket }) => void
  broadcast: (frame: ServeFrame) => void
  hangUp: () => void
  clients: () => number
}

type HelloFrame = Extract<ClientFrame, { kind: EClientFrame.Hello }>

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback

export function createSessionHandlers(args: {
  threadId: ThreadId
  buffer: FrameBuffer
  inFlight: () => readonly SignalFrame[]
  liveStepId: () => StepId | null
  driver: ServeTurnDriver
  files: Pick<FileBrowser, 'list'>
  refusal: () => string | null
  log: ServeLog
}): SessionHandlers {
  const { threadId, buffer, inFlight, liveStepId, driver, files, refusal, log } = args
  const live = new Set<SessionSocket>()
  const attached = new Set<SessionSocket>()
  const aliaser = createStepAliaser()

  const send = (args: { socket: SessionSocket; frame: ServeFrame }): void => {
    args.socket.send(encodeFrame(args.frame))
  }

  /** The alias lives exactly as long as the step it renames, and only for the socket that reloaded. */
  const forSocket = (args: { socket: SessionSocket; frame: ServeFrame }): ServeFrame => {
    const alias = args.socket.data.alias
    if (alias === null) return args.frame

    const frame = retagged({ frame: args.frame, alias })
    if (endsAliasedStep({ frame: args.frame, alias })) args.socket.data.alias = null
    return frame
  }

  const refuse = (args: { socket: SessionSocket; reason: string }): void => {
    send({ socket: args.socket, frame: { kind: EServeFrame.Error, message: args.reason } })
    log({ event: EServeEvent.ClientRefused, reason: args.reason })
    args.socket.close(POLICY_VIOLATION, args.reason)
  }

  /**
   * A cursor the buffer still holds resumes exactly; anything else — one that fell out, or a
   * process that restarted with an empty buffer — is told to re-read the durable log, so a gap can
   * never be silent. The in-flight step rides on top, since its deltas have no events behind them.
   */
  const greet = (args: { socket: SessionSocket; hello: HelloFrame }): void => {
    const { socket, hello } = args
    const cursor = hello.channelCursor
    const resumed = cursor !== null && buffer.holds(cursor)

    if (!resumed) {
      send({ socket, frame: { kind: EServeFrame.Reload, sinceEventSeq: hello.lastEventSeq } })
    }

    send({ socket, frame: { kind: EServeFrame.Ready, seq: buffer.nextSeq() } })

    const blocked = refusal()
    if (blocked !== null) send({ socket, frame: { kind: EServeFrame.Error, message: blocked } })

    const backfill = resumed && cursor !== null ? buffer.after(cursor) : inFlight()
    const reloadedMidStep = resumed ? null : liveStepId()
    socket.data.alias = reloadedMidStep === null ? null : aliaser.next(reloadedMidStep)

    for (const frame of backfill) send({ socket, frame: forSocket({ socket, frame }) })

    socket.data.helloed = true
    attached.add(socket)
    log({
      event: EServeEvent.ClientAttached,
      resumed,
      cursor,
      backfilled: backfill.length,
      clients: attached.size,
    })
  }

  const drive = (args: { socket: SessionSocket; frame: ClientFrame }): void => {
    const { socket, frame } = args

    if (frame.kind === EClientFrame.Send) {
      void driver.say({ text: frame.text }).catch((error: unknown) => {
        const message = messageOf(error, 'the message was not accepted')
        send({ socket, frame: { kind: EServeFrame.Error, message } })
      })
      return
    }

    if (frame.kind === EClientFrame.Run) {
      try {
        driver.run()
      } catch (error) {
        send({
          socket,
          frame: { kind: EServeFrame.Error, message: messageOf(error, 'the turn was not accepted') },
        })
      }
      return
    }

    if (frame.kind === EClientFrame.Interrupt) {
      driver.interrupt()
      return
    }

    if (frame.kind !== EClientFrame.Request) return

    void answerRequest({ frame, files })
      .then((reply) => send({ socket, frame: reply }))
      .catch((error: unknown) =>
        send({
          socket,
          frame: {
            kind: EServeFrame.Reply,
            replyTo: frame.id,
            ok: false,
            data: { message: messageOf(error, 'the request failed') },
          },
        }),
      )
  }

  return {
    open({ socket }) {
      live.add(socket)
    },

    message({ socket, message }) {
      const frame = decodeClientFrame(typeof message === 'string' ? message : message.toString())
      if (frame === null) {
        refuse({ socket, reason: 'that frame did not decode' })
        return
      }

      if (frame.kind === EClientFrame.Hello) {
        if (socket.data.helloed) {
          refuse({ socket, reason: 'hello arrives once' })
          return
        }
        if (frame.threadId !== threadId) {
          refuse({ socket, reason: 'this sandbox serves one thread' })
          return
        }
        greet({ socket, hello: frame })
        return
      }

      if (!socket.data.helloed) {
        refuse({ socket, reason: 'the first frame must be hello' })
        return
      }

      drive({ socket, frame })
    },

    close({ socket }) {
      live.delete(socket)
      if (!attached.delete(socket)) return
      log({ event: EServeEvent.ClientDetached, clients: attached.size })
    },

    broadcast(frame) {
      const encoded = encodeFrame(frame)
      for (const socket of attached) {
        if (socket.data.alias === null) {
          socket.send(encoded)
          continue
        }
        socket.send(encodeFrame(forSocket({ socket, frame })))
      }
    },

    hangUp() {
      for (const socket of live) socket.terminate()
      live.clear()
      attached.clear()
    },

    clients: () => attached.size,
  }
}
