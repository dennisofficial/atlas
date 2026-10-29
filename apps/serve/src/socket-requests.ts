import type { ThreadId } from '@dltech/atlas-core'
import { EClientRequest, EServeFrame } from '@dltech/atlas-harness'
import type { FileBrowser } from '@dltech/atlas-harness'
import type { RotationStateWire } from '@dltech/atlas-wire'

import { isAgentSteerOp } from './agent-steer'
import { routeAgentSteerRequest } from './agent-steer-routing'
import { createCompactionRequests, isCompactionOp } from './compaction-requests'
import { routeContextRead } from './context-routing'
import type { ContextReaders } from './context-requests'
import { routeFileRequest } from './file-routing'
import { createHistoryMutations } from './history-mutations'
import { routeMentionRead, type MentionRouting } from './mention-requests'
import { routeOperatorInput } from './operator-input'
import { routeProcessRequest, type ServeProcesses } from './process-requests'
import { refusedRequest, type RequestFrame, type TranscriptReaders } from './requests'
import { answerRewindRequest } from './rewind-request'
import { createRotationRequests, isRotationOp } from './rotation-requests'
import type { ServeAgentSteer, ServeRewind, ServeRoster } from './serve-app'
import { EServeEvent, type ServeLog } from './serve-log'
import type { ThreadModelPersister } from './serve-thread-model-persist'
import { routeSessionToolRequest } from './session-tool-routing'
import type { SessionTools } from './session-tool-requests'
import type { SessionSocket } from './socket-session'
import { routeTranscriptRead, routeTranscriptWrite } from './transcript-routing'
import type { ServeTurnDriver } from './turn-driver'

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
  tools?: SessionTools | undefined
  processes?: ServeProcesses | undefined
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
        frame: {
          kind: EServeFrame.Reply,
          replyTo: frame.id,
          ok: true,
          data: snapshot(),
        },
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
        log({
          event: EServeEvent.ClientRefused,
          reason: 'rewind-without-registries',
        })
      void edits
        .run(async () => {
          const reply = await answerRewindRequest({
            frame,
            threadId,
            driver,
            rewind,
          })
          if (reply.ok) args.historyChanged?.()
          return reply
        })
        .then((reply) => send({ socket, frame: reply }))
      return
    }

    if (
      routeAgentSteerRequest({
        frame,
        agents,
        run: edits.run,
        reply: (reply) => send({ socket, frame: reply }),
      })
    )
      return

    if (
      routeOperatorInput({
        frame,
        threadId,
        operatorInput: args.operatorInput,
        reply: (reply) => send({ socket, frame: reply }),
      })
    )
      return

    if (
      routeProcessRequest({
        frame,
        threadId,
        processes: args.processes,
        reply: (reply) => send({ socket, frame: reply }),
      })
    )
      return

    if (
      routeSessionToolRequest({
        frame,
        tools: args.tools,
        reply: (reply) => send({ socket, frame: reply }),
      })
    )
      return

    if (
      routeTranscriptRead({
        frame,
        transcript,
        threadId,
        reply: (reply) => send({ socket, frame: reply }),
      })
    )
      return

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
      routeContextRead({
        frame,
        context,
        reply: (reply) => send({ socket, frame: reply }),
      })
    )
      return

    if (
      routeTranscriptWrite({
        frame,
        transcript,
        threadId,
        log,
        selectModel,
        persistModel: args.persistModel,
        reply: (reply) => send({ socket, frame: reply }),
      })
    )
      return

    routeFileRequest({
      frame,
      files,
      reply: (reply) => send({ socket, frame: reply }),
    })
  }

  return { route, compaction: compact, rotation: rotate }
}
