import type { ThreadId } from '@dltech/atlas-core'
import { EClientRequest, EServeFrame } from '@dltech/atlas-harness'
import type { FileBrowser } from '@dltech/atlas-harness'
import type { RotationStateWire } from '@dltech/atlas-wire'

import { answerAgentSteer, isAgentSteerOp } from './agent-steer'
import { routeOperatorInput } from './operator-input'
import { answerContextRead, isContextOp, type ContextReaders } from './context-requests'
import { routeMentionRead, type MentionRouting } from './mention-requests'
import {
  answerRequest,
  answerTranscriptRead,
  answerTranscriptWrite,
  isTranscriptReadOp,
  isTranscriptWriteOp,
  refusedRequest,
  type RequestFrame,
  type TranscriptReaders,
} from './requests'
import { answerRewindRequest } from './rewind-request'
import { createHistoryMutations } from './history-mutations'
import { createCompactionRequests, isCompactionOp } from './compaction-requests'
import { createRotationRequests, isRotationOp } from './rotation-requests'
import { routeSessionMirrorRead, type SessionMirrorRouting } from './session-mirror-requests'
import type { ServeAgentSteer, ServeRewind, ServeRoster } from './serve-app'
import { EServeEvent, type ServeLog } from './serve-log'
import type { ThreadModelPersister } from './serve-thread-model-persist'
import type { SessionSocket } from './socket-session'
import type { ServeTurnDriver } from './turn-driver'
export const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback

export function createRequestRouter(args: {
  threadId: ThreadId
  driver: ServeTurnDriver
  files: Pick<FileBrowser, 'list'>
  log: ServeLog
  snapshot: ServeRoster['snapshot']
  prStates?: (() => readonly import('@dltech/atlas-wire').PrStateWire[]) | undefined
  send: (args: { socket: SessionSocket; frame: import('@dltech/atlas-harness').ServeFrame }) => void
  rewind?: ServeRewind | undefined
  compaction?: import('@dltech/atlas-harness').CompactionPort | undefined
  rotation?: import('@dltech/atlas-harness').RotationPort | undefined
  broadcastRotation?: ((rotation: RotationStateWire) => void) | undefined
  historyChanged?: (() => void) | undefined
  agents?: ServeAgentSteer | undefined
  operatorInput?: Pick<import('@dltech/atlas-harness').OperatorInputPort, 'answer'> | undefined
  context?: ContextReaders | undefined
  mentions?: MentionRouting | undefined
  transcript?: TranscriptReaders | undefined
  selectModel?: ((model: { ref: string; effort: string }) => void) | undefined
  persistModel?: ThreadModelPersister | undefined
  sessionMirror?: SessionMirrorRouting | undefined
}) {
  const { threadId, driver, files, log, snapshot, send, rewind, agents, transcript, selectModel } =
    args
  const prStates = args.prStates ?? (() => [])
  const context = args.context
  const edits = createHistoryMutations()
  const compact = createCompactionRequests({
    threadId,
    driver: {
      holdHistory: () => {
        edits.assertAvailable()
        return driver.holdHistory()
      },
    },
    compaction: args.compaction,
    changed: args.historyChanged ?? (() => undefined),
  })

  const rotate = createRotationRequests({
    threadId,
    driver: {
      holdForRotation: () => {
        edits.assertAvailable()
        return driver.holdForRotation()
      },
      beginRotation: driver.beginRotation,
    },
    rotation: args.rotation,
    broadcast: args.broadcastRotation ?? (() => undefined),
    changed: args.historyChanged ?? (() => undefined),
    log,
  })

  const route = (routed: { socket: SessionSocket; frame: RequestFrame }): void => {
    const { socket, frame } = routed
    if (isCompactionOp(frame.op)) {
      void compact.answer(frame).then((reply) => send({ socket, frame: reply }))
      return
    }
    if (isRotationOp(frame.op)) {
      void rotate.answer(frame).then((reply) => send({ socket, frame: reply }))
      return
    }
    if (frame.op === EClientRequest.ListRoster) {
      send({
        socket,
        frame: { kind: EServeFrame.Reply, replyTo: frame.id, ok: true, data: snapshot() },
      })
      return
    }

    if (frame.op === EClientRequest.ListPrStates) {
      send({
        socket,
        frame: {
          kind: EServeFrame.Reply,
          replyTo: frame.id,
          ok: true,
          data: { states: prStates() },
        },
      })
      return
    }

    if (rotate.active() && (frame.op === EClientRequest.Rewind || isAgentSteerOp(frame.op))) {
      send({
        socket,
        frame: refusedRequest({
          replyTo: frame.id,
          message: 'the session is rotating — wait for it to finish',
        }),
      })
      return
    }
    if (compact.active() && (frame.op === EClientRequest.Rewind || isAgentSteerOp(frame.op))) {
      send({
        socket,
        frame: refusedRequest({
          replyTo: frame.id,
          message: 'the history is being summarised — wait for it to finish',
        }),
      })
      return
    }
    if (frame.op === EClientRequest.Rewind) {
      if (rewind === undefined)
        log({ event: EServeEvent.ClientRefused, reason: 'rewind-without-registries' })
      void edits
        .run(async () => {
          const reply = await answerRewindRequest({ frame, threadId, driver, rewind })
          if (reply.ok) args.historyChanged?.()
          return reply
        })
        .then((reply) => send({ socket, frame: reply }))
      return
    }

    if (isAgentSteerOp(frame.op)) {
      if (agents === undefined) {
        send({
          socket,
          frame: refusedRequest({
            replyTo: frame.id,
            message: 'this serve holds no agents to steer',
          }),
        })
        return
      }
      void edits
        .run(() => answerAgentSteer({ frame, agents }))
        .then((reply) => send({ socket, frame: reply }))
        .catch((error: unknown) =>
          send({
            socket,
            frame: {
              kind: EServeFrame.Reply,
              replyTo: frame.id,
              ok: false,
              data: { message: messageOf(error, 'the agent steer failed') },
            },
          }),
        )
      return
    }

    if (
      routeOperatorInput({
        frame,
        threadId,
        operatorInput: args.operatorInput,
        reply: (reply) => send({ socket, frame: reply }),
      })
    )
      return

    if (isTranscriptReadOp(frame.op)) {
      if (transcript === undefined) {
        send({
          socket,
          frame: refusedRequest({
            replyTo: frame.id,
            message: 'this serve has no transcript to read',
          }),
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

    if (
      routeMentionRead({
        frame,
        root: threadId,
        mentions: args.mentions,
        reply: (reply) => send({ socket, frame: reply }),
      })
    )
      return

    if (
      routeSessionMirrorRead({
        frame,
        mirror: args.sessionMirror,
        reply: (reply) => send({ socket, frame: reply }),
      })
    )
      return

    if (isContextOp(frame.op)) {
      if (context === undefined) {
        send({
          socket,
          frame: refusedRequest({
            replyTo: frame.id,
            message: 'this serve has no context folder to read',
          }),
        })
        return
      }
      void answerContextRead({ frame, context })
        .then((reply) => send({ socket, frame: reply }))
        .catch((error: unknown) =>
          send({
            socket,
            frame: {
              kind: EServeFrame.Reply,
              replyTo: frame.id,
              ok: false,
              data: { message: messageOf(error, 'the context read failed') },
            },
          }),
        )
      return
    }

    if (isTranscriptWriteOp(frame.op)) {
      if (transcript === undefined) {
        send({
          socket,
          frame: refusedRequest({
            replyTo: frame.id,
            message: 'this serve has no transcript to write',
          }),
        })
        return
      }
      void answerTranscriptWrite({
        frame,
        transcript,
        threadId,
        log,
        ...(selectModel === undefined ? {} : { select: selectModel }),
        ...(args.persistModel === undefined ? {} : { persist: args.persistModel }),
      })
        .then((reply) => send({ socket, frame: reply }))
        .catch((error: unknown) =>
          send({
            socket,
            frame: {
              kind: EServeFrame.Reply,
              replyTo: frame.id,
              ok: false,
              data: { message: messageOf(error, 'the transcript write failed') },
            },
          }),
        )
      return
    }

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

  return { route, compaction: compact, rotation: rotate }
}
