import { rosterWireSchema, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import {
  CHANNEL_PROTOCOL_VERSION,
  EClientFrame,
  EClientRequest,
  EServeFrame,
  decodeClientFrame,
  encodeFrame,
  type ClientFrame,
  type ServeFrame,
} from '@dltech/atlas-harness'

import { pendingEntriesOf, refusedRequest } from './requests'
import { EServeEvent } from './serve-log'
import type { ServeRoster } from './serve-app'
import { createTurnCommands } from './socket-commands'
import { createRequestRouter, messageOf } from './socket-requests'
import type { HelloFrame, SessionHandlers, SessionHandlersArgs, SessionSocket } from './socket-session-types'
import { createMutationTracker, isReadOnlyFrame, routeStateRequest } from './socket-state-requests'
import { createStepAliaser, endsAliasedStep, retagged } from './step-alias'

export type {
  HelloFrame,
  SessionHandlers,
  SessionHandlersArgs,
  SessionSocket,
  SocketState,
} from './socket-session-types'

const POLICY_VIOLATION = 1008
const GOING_AWAY = 1001

/** A serve without registries (a spec fake) has nothing to report — an empty roster, not an error. */
const EMPTY_ROSTER: ServeRoster['snapshot'] = () => ({ shells: [], agents: [], services: [] })

export function createSessionHandlers(args: SessionHandlersArgs): SessionHandlers {
  const { threadId, buffer, inFlight, liveStepId, driver, files, refusal, log } = args
  const snapshot = args.roster?.snapshot ?? EMPTY_ROSTER
  const rewind = args.rewind
  const agents = args.agents
  const pending = args.pending
  const transcript = args.transcript
  const selectModel = args.selectModel
  const sessionArchive = args.sessionArchive
  const memoryArchive = args.memoryArchive
  const restoreTranscript = args.restoreTranscript
  const workspaceOps = args.workspace
  const { admissionClosed, checkpoint, checkpointChanged } = args
  const mutations = createMutationTracker({ changed: checkpointChanged })
  const live = new Set<SessionSocket>()
  const attached = new Set<SessionSocket>()
  const aliaser = createStepAliaser()

  const send = (args: { socket: SessionSocket; frame: ServeFrame }): void => {
    args.socket.send(encodeFrame(args.frame))
  }

  const command = createTurnCommands({ threadId, driver, buffer, log, send, applyUserSettings: args.applyUserSettings })

  const router = createRequestRouter({
    threadId,
    driver,
    files,
    log,
    snapshot,
    send: (sent) => {
      mutations.observe(sent.frame)
      send(sent)
    },
    rewind,
    agents,
    transcript,
    selectModel,
    sessionArchive,
    memoryArchive,
    restoreTranscript,
    workspace: workspaceOps,
  })

  const checkpointField = (): { checkpoint?: RuntimeCheckpoint } => {
    const current = checkpoint?.() ?? null
    return current === null ? {} : { checkpoint: current }
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
        turnInFlight: driver.outcomePending(),
        ...checkpointField(),
      },
    })

    const blocked = refusal()
    if (blocked !== null) send({ socket, frame: { kind: EServeFrame.Error, message: blocked } })

    const queued = pending === undefined ? [] : pendingEntriesOf({ pending, threadId })
    if (queued.length > 0) {
      send({
        socket,
        frame: {
          kind: EServeFrame.Signal,
          seq: Math.max(0, buffer.nextSeq() - 1),
          signal: { type: 'pending-changed', entries: queued },
        },
      })
    }

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

  const refuseDeferred = (args: { socket: SessionSocket; frame: ClientFrame; message: string }): void => {
    send({
      socket: args.socket,
      frame: args.frame.kind === EClientFrame.Request
        ? refusedRequest({ replyTo: args.frame.id, message: args.message })
        : { kind: EServeFrame.Error, message: args.message },
    })
  }

  const drive = (args: { socket: SessionSocket; frame: ClientFrame }): void => {
    const { socket, frame } = args

    if (admissionClosed?.() === true && !isReadOnlyFrame(frame)) {
      refuseDeferred({ socket, frame, message: 'this sandbox is parking and accepts no new work' })
      return
    }

    const isRestoreOp = frame.kind === EClientFrame.Request && frame.op === EClientRequest.RestoreTranscript
    if (router.state.restoring !== null && !isRestoreOp) {
      const held = router.state.restoring
      void held.then((result) => {
        if (result.failed !== null) {
          refuseDeferred({ ...args, message: `the transcript restore failed: ${result.failed}` })
          return
        }
        drive({ socket, frame })
      }).catch((error: unknown) => {
        refuseDeferred({ ...args, message: messageOf(error, 'the transcript restore failed') })
      })
      return
    }

    command({ socket, frame })
    if (frame.kind !== EClientFrame.Request) return
    if (routeStateRequest({ socket, frame, send, checkpoint, pending })) return
    if (!isReadOnlyFrame(frame)) mutations.begin(frame.id)
    router.route({ socket, frame })
  }

  const broadcast = (frame: ServeFrame): void => {
    const encoded = encodeFrame(frame)
    for (const socket of attached) {
      if (socket.data.alias === null) {
        socket.send(encoded)
        continue
      }
      socket.send(encodeFrame(forSocket({ socket, frame })))
    }
  }

  const unsubscribePending = pending?.subscribe(() => {
    broadcast(buffer.push({ type: 'pending-changed', entries: pendingEntriesOf({ pending, threadId }) }))
  })

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
      log({
        event: EServeEvent.ClientDetached,
        clients: attached.size,
        actor: 'transport',
        running: driver.running(),
        execution: 'preserved',
      })
    },

    broadcast,

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
        send({ socket, frame: { kind: EServeFrame.Parked, reason: args.reason, ...checkpointField() } })
        socket.close(GOING_AWAY, args.reason)
      }
    },

    hangUp() {
      unsubscribePending?.()
      for (const socket of live) socket.terminate()
      live.clear()
      attached.clear()
    },

    clients: () => attached.size,
    settling: () => router.state.restoring !== null || mutations.active(),
  }
}
