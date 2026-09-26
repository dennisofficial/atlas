import type { ServerWebSocket } from 'bun'

import { eventBodySchema, type EventDraft, type ThreadId } from '@dltech/atlas-core'
import { rosterWireSchema } from '@dltech/atlas-wire'

import type { StepId } from '../channel/signal'

import {
  CHANNEL_PROTOCOL_VERSION,
  EClientFrame,
  EClientRequest,
  EServeFrame,
  decodeClientFrame,
  encodeFrame,
  type ClientFrame,
  type ServeFrame,
} from '../cloud/channel-wire'
import type { FileBrowser } from '../files/file-browser'

import type { FrameBuffer, SignalFrame } from './frame-buffer'
import type { WorkspacePublisher } from './publish-workspace'
import {
  answerRequest,
  answerTranscriptRead,
  answeredRequest,
  isTranscriptReadOp,
  refusedRequest,
  type TranscriptReaders,
} from './requests'
import { answerRewind } from './rewind-apply'
import type { ServeRoster, ServeRewind } from './serve-app'
import { EServeEvent, type ServeLog } from './serve-log'
import { createStepAliaser, endsAliasedStep, retagged, type StepAlias } from './step-alias'
import type { ServeTurnDriver } from './turn-driver'

const POLICY_VIOLATION = 1008
const GOING_AWAY = 1001

export type SocketState = { helloed: boolean; alias: StepAlias | null }

export type SessionSocket = ServerWebSocket<SocketState>

export type SessionHandlers = {
  open: (args: { socket: SessionSocket }) => void
  message: (args: { socket: SessionSocket; message: string | Buffer }) => void
  close: (args: { socket: SessionSocket }) => void
  broadcast: (frame: ServeFrame) => void
  broadcastRoster: () => void
  park: (args: { reason: string }) => void
  hangUp: () => void
  clients: () => number
}

/** A serve without registries (a spec fake) has nothing to report — an empty roster, not an error. */
const EMPTY_ROSTER: ServeRoster['snapshot'] = () => ({ shells: [], agents: [], services: [] })

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
  publish: WorkspacePublisher
  refusal: () => string | null
  log: ServeLog
  roster?: ServeRoster | undefined
  rewind?: ServeRewind | undefined
  /** The transcript stores the read-ops answer from; absent in fakes, which refuse the ops. */
  transcript?: TranscriptReaders | undefined
  /** Tars the served session directory for the descend's transfer; absent in fakes. */
  sessionArchive?: (() => Promise<Uint8Array | null>) | undefined
}): SessionHandlers {
  const { threadId, buffer, inFlight, liveStepId, driver, files, publish, refusal, log } = args
  const snapshot = args.roster?.snapshot ?? EMPTY_ROSTER
  const rewind = args.rewind
  const transcript = args.transcript
  const sessionArchive = args.sessionArchive
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

    send({
      socket,
      frame: {
        kind: EServeFrame.Ready,
        seq: buffer.nextSeq(),
        protocol: CHANNEL_PROTOCOL_VERSION,
        turnInFlight: driver.running(),
      },
    })

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
      let context: EventDraft[] | undefined
      try {
        context = frame.context?.map((draft): EventDraft => eventBodySchema.parse(draft))
      } catch {
        send({ socket, frame: { kind: EServeFrame.Error, message: 'a context draft was not an event body' } })
        return
      }
      void driver
        .say({
          text: frame.text,
          ...(frame.images === undefined ? {} : { images: frame.images }),
          ...(context === undefined ? {} : { context }),
        })
        .catch((error: unknown) => {
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
      send({ socket, frame: { kind: EServeFrame.InterruptAcked, seq: buffer.nextSeq() } })
      return
    }

    if (frame.kind !== EClientFrame.Request) return

    if (frame.op === EClientRequest.ListRoster) {
      send({
        socket,
        frame: { kind: EServeFrame.Reply, replyTo: frame.id, ok: true, data: snapshot() },
      })
      return
    }

    if (frame.op === EClientRequest.Rewind) {
      if (rewind === undefined) {
        log({ event: EServeEvent.ClientRefused, reason: 'rewind-without-registries' })
        send({
          socket,
          frame: {
            kind: EServeFrame.Reply,
            replyTo: frame.id,
            ok: false,
            data: { message: 'this serve has nothing a rewind could cut' },
          },
        })
        return
      }
      const target = rewind.target
      void answerRewind({
        frame,
        threadId,
        target,
        driver,
        ...(rewind.truncate === undefined ? {} : { truncate: { truncate: rewind.truncate } }),
      })
        .then((reply) => send({ socket, frame: reply }))
        .catch((error: unknown) =>
          send({
            socket,
            frame: {
              kind: EServeFrame.Reply,
              replyTo: frame.id,
              ok: false,
              data: { message: messageOf(error, 'the rewind cleanup failed') },
            },
          }),
        )
      return
    }

    if (isTranscriptReadOp(frame.op)) {
      if (transcript === undefined) {
        send({
          socket,
          frame: refusedRequest({ replyTo: frame.id, message: 'this serve has no transcript to read' }),
        })
        return
      }
      void answerTranscriptRead({ frame, transcript: transcript, threadId })
        .then((reply) => send({ socket, frame: reply }))
        .catch((error: unknown) =>
          send({
            socket,
            frame: {
              kind: EServeFrame.Reply,
              replyTo: frame.id,
              ok: false,
              data: { message: messageOf(error, 'the transcript read failed') },
            },
          }),
        )
      return
    }

    if (frame.op === EClientRequest.ReadSessionArchive) {
      const archive = sessionArchive
      if (archive === undefined) {
        send({
          socket,
          frame: refusedRequest({ replyTo: frame.id, message: 'this serve has no transcript to read' }),
        })
        return
      }
      void archive()
        .then((bytes) =>
          send({
            socket,
            frame: answeredRequest({
              replyTo: frame.id,
              data: { archive: bytes === null ? '' : Buffer.from(bytes).toString('base64') },
            }),
          }),
        )
        .catch((error: unknown) =>
          send({
            socket,
            frame: {
              kind: EServeFrame.Reply,
              replyTo: frame.id,
              ok: false,
              data: { message: messageOf(error, 'the transcript archive failed') },
            },
          }),
        )
      return
    }

    void answerRequest({ frame, files, publish })
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
        if (frame.protocol !== undefined && frame.protocol !== CHANNEL_PROTOCOL_VERSION) {
          const reason =
            frame.protocol > CHANNEL_PROTOCOL_VERSION
              ? `this Atlas speaks a newer wire protocol (${frame.protocol}) than this sandbox's serve (${CHANNEL_PROTOCOL_VERSION}) — re-open the conversation so the sandbox's serve is rebuilt`
              : `this Atlas speaks an older wire protocol (${frame.protocol}) than this sandbox's serve (${CHANNEL_PROTOCOL_VERSION}) — update Atlas, then re-open the conversation`
          refuse({ socket, reason })
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

    broadcastRoster() {
      const frame: ServeFrame = { kind: EServeFrame.Roster, roster: rosterWireSchema.parse(snapshot()) }
      const encoded = encodeFrame(frame)
      for (const socket of attached) socket.send(encoded)
    },

    /**
     * A clean close, never terminate(): terminate is what leaves a client staring at a bare 1006
     * until Vercel's edge notices the socket is dead, up to 340s later.
     */
    park(args) {
      const clients = [...attached]
      log({ event: EServeEvent.ClientsParked, clients: clients.length, reason: args.reason })
      for (const socket of clients) {
        send({ socket, frame: { kind: EServeFrame.Parked, reason: args.reason } })
        socket.close(GOING_AWAY, args.reason)
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
