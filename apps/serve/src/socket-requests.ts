import type { ThreadId } from '@dltech/atlas-core'
import {
  EClientRequest,
  EServeFrame,
  restoreTranscriptParamsSchema,
  type RestoreTranscriptParams,
} from '@dltech/atlas-harness'
import type { FileBrowser } from '@dltech/atlas-harness'

import { answerArchiveRead, isArchiveReadOp } from './archive-requests'
import { answerAgentSteer, isAgentSteerOp } from './agent-steer'
import { routeOperatorInput } from './operator-input'
import { answerContextRead, isContextOp, type ContextReaders } from './context-requests'
import {
  answerRequest,
  answerTranscriptRead,
  answerTranscriptWrite,
  answeredRequest,
  isTranscriptReadOp,
  isTranscriptWriteOp,
  refusedRequest,
  type RequestFrame,
  type TranscriptReaders,
} from './requests'
import { answerRewind } from './rewind-apply'
import type { ServeAgentSteer, ServeRewind, ServeRoster } from './serve-app'
import { EServeEvent, type ServeLog } from './serve-log'
import type { SessionSocket } from './socket-session'
import type { ServeTurnDriver } from './turn-driver'
import { answerWorkspaceTransfer, isWorkspaceTransferOp } from './workspace-ops'

type WorkspaceOps = Pick<Parameters<typeof answerWorkspaceTransfer>[0], 'prepare' | 'apply' | 'activate'>

export type RestoreOutcome = { restored: boolean; failed: string | null }

export const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback

export function createRequestRouter(args: {
  threadId: ThreadId
  driver: ServeTurnDriver
  files: Pick<FileBrowser, 'list'>
  log: ServeLog
  snapshot: ServeRoster['snapshot']
  send: (args: { socket: SessionSocket; frame: import('@dltech/atlas-harness').ServeFrame }) => void
  rewind?: ServeRewind | undefined
  agents?: ServeAgentSteer | undefined
  operatorInput?: Pick<import('@dltech/atlas-harness').OperatorInputPort, 'answer'> | undefined
  context?: ContextReaders | undefined
  transcript?: TranscriptReaders | undefined
  selectModel?: ((model: { ref: string; effort: string }) => void) | undefined
  sessionArchive?: (() => Promise<Uint8Array | null>) | undefined
  memoryArchive?: (() => Promise<Uint8Array | null>) | undefined
  restoreTranscript?: ((marker?: RestoreTranscriptParams['locationChanged']) => Promise<RestoreOutcome>) | undefined
  workspace?: WorkspaceOps | undefined
}) {
  const { threadId, driver, files, log, snapshot, send, rewind, agents, transcript, selectModel } = args
  const context = args.context
  const { sessionArchive, memoryArchive, restoreTranscript } = args
  const workspaceOps = args.workspace
  const state: { restoring: Promise<RestoreOutcome> | null } = { restoring: null }

  const route = (routed: { socket: SessionSocket; frame: RequestFrame }): void => {
    const { socket, frame } = routed
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

  if (isAgentSteerOp(frame.op)) {
    if (agents === undefined) {
      send({
        socket,
        frame: refusedRequest({ replyTo: frame.id, message: 'this serve holds no agents to steer' }),
      })
      return
    }
    void answerAgentSteer({ frame, agents })
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

  if (routeOperatorInput({ frame, threadId, operatorInput: args.operatorInput, reply: (reply) => send({ socket, frame: reply }) })) return

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

  if (isContextOp(frame.op)) {
    if (context === undefined) {
      send({
        socket,
        frame: refusedRequest({ replyTo: frame.id, message: 'this serve has no context folder to read' }),
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
        frame: refusedRequest({ replyTo: frame.id, message: 'this serve has no transcript to write' }),
      })
      return
    }
    void answerTranscriptWrite({
      frame,
      transcript,
      threadId,
      ...(selectModel === undefined ? {} : { select: selectModel }),
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

  if (isWorkspaceTransferOp(frame.op)) {
    void answerWorkspaceTransfer({ frame, busy: () => driver.busy(), ...workspaceOps })
      .then((reply) => send({ socket, frame: reply }))
    return
  }

  if (frame.op === EClientRequest.RestoreTranscript) {
    if (restoreTranscript === undefined) {
      send({
        socket,
        frame: refusedRequest({ replyTo: frame.id, message: 'this serve cannot restore a transcript' }),
      })
      return
    }
    if (driver.busy()) {
      send({
        socket,
        frame: refusedRequest({ replyTo: frame.id, message: 'a turn is running, so the transcript cannot be replaced' }),
      })
      return
    }
    const parsed = restoreTranscriptParamsSchema.safeParse(frame.params ?? {})
    const marker = parsed.success ? parsed.data.locationChanged : undefined
    state.restoring ??= restoreTranscript(marker).finally(() => {
      state.restoring = null
    })
    void state.restoring
      .then((result) =>
        send({
          socket,
          frame:
            result.failed === null
              ? answeredRequest({ replyTo: frame.id, data: { restored: result.restored } })
              : refusedRequest({ replyTo: frame.id, message: result.failed }),
        }),
      )
      .catch((error: unknown) =>
        send({
          socket,
          frame: {
            kind: EServeFrame.Reply,
            replyTo: frame.id,
            ok: false,
            data: { message: messageOf(error, 'the transcript restore failed') },
          },
        }),
      )
    return
  }

  if (isArchiveReadOp(frame.op)) {
    void answerArchiveRead({ frame, sessionArchive, memoryArchive })
      .then((reply) => send({ socket, frame: reply }))
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

  return { route, state }
}
