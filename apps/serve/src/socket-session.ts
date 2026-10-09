import { prStatesWireSchema, rosterWireSchema, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import {
  EClientFrame,
  EClientRequest,
  EServeFrame,
  decodeClientFrame,
  encodeFrame,
  type ClientFrame,
  type ServeFrame,
} from '@dltech/atlas-harness'

import { admitsThread, protocolRefusal } from './hello-admission'
import { pendingEntriesOf, refusedRequest } from './requests'
import { EServeEvent } from './serve-log'
import type { ServeRoster } from './serve-app'
import { createTurnCommands } from './socket-commands'
import { createRequestRouter, messageOf } from './socket-requests'
import { createSocketGreeter } from './socket-greet'
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

const EMPTY_ROSTER: ServeRoster['snapshot'] = () => ({ shells: [], agents: [], services: [] })

const EMPTY_PR_STATES: NonNullable<SessionHandlersArgs['prStates']>['snapshot'] = () => []

export function createSessionHandlers(args: SessionHandlersArgs): SessionHandlers {
  const { threadId, buffer, inFlight, liveStepId, driver, files, refusal, log } = args
  const snapshot = args.roster?.snapshot ?? EMPTY_ROSTER
  const prStatesSnapshot = args.prStates?.snapshot ?? EMPTY_PR_STATES
  const { rewind, agents, operatorInput, pending, transcript, selectModel } = args
  const { sessionArchive, memoryArchive, restoreTranscript } = args
  const { admissionClosed, checkpoint, checkpointChanged, workspace: workspaceOps } = args
  const mutations = createMutationTracker({ changed: checkpointChanged })
  const live = new Set<SessionSocket>()
  const attached = new Set<SessionSocket>()
  const aliaser = createStepAliaser()
  let historyGeneration = 0

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
    prStates: prStatesSnapshot,
    send: (sent) => {
      mutations.observe(sent.frame)
      send(sent)
    },
    rewind,
    compaction: args.compaction,
    rotation: args.rotation,
    authority: args.authority,
    broadcastRotation: (rotation) => broadcast(buffer.push({ type: 'rotation-changed', rotation })),
    broadcastArchiveProgress: (progress) => {
      try {
        broadcast(buffer.push({ type: 'archive-progress', ...progress }))
      } catch {
        // Progress is advisory; a socket hiccup must not fail the archive it describes.
      }
    },
    historyChanged: () => {
      historyGeneration += 1
      broadcast(buffer.pushLifecycle({ kind: EServeFrame.Reload, sinceEventSeq: 0 }))
      broadcast(buffer.push({ type: 'events-appended' }))
    },
    agents,
    operatorInput: args.operatorInput,
    context: args.context, mentions: args.mentions,
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

  const greetRest = createSocketGreeter({
    threadId: () => driver.servedThread(), buffer, inFlight, liveStepId, driver, pending, operatorInput, checkpointField,
    historyGeneration: () => historyGeneration, refusal, aliaser, attached, send, forSocket,
    drive: (driven) => drive(driven), log, rotation: () => router.rotation.current(),
  })

  const greet = (args: { socket: SessionSocket; hello: HelloFrame }): void => {
    const { socket, hello } = args
    if (transcript === undefined) {
      greetRest({ socket, hello, head: null })
      return
    }

    // The currency vouch answers for the thread the Hello names: after a rotation commits, a
    // client re-attaching on the successor is vouched against the successor's head, not the
    // predecessor's frozen one.
    void transcript.log.head({ threadId: hello.threadId }).then(
      (head) => {
        if (!live.has(socket)) return
        greetRest({ socket, hello, head })
      },
      () => {
        if (!live.has(socket)) return
        greetRest({ socket, hello, head: null })
      },
    )
  }

  const refuseDeferred = (args: { socket: SessionSocket; frame: ClientFrame; message: string }): void => {
    send({
      socket: args.socket,
      frame:
        args.frame.kind === EClientFrame.Request
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
      void held
        .then((result) => {
          if (result.failed !== null) {
            refuseDeferred({ ...args, message: `the transcript restore failed: ${result.failed}` })
            return
          }
          drive({ socket, frame })
        })
        .catch((error: unknown) => {
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
    broadcast(buffer.push({ type: 'pending-changed', entries: pendingEntriesOf({ pending, threadId: driver.servedThread() }) }))
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
        const mismatch = protocolRefusal(frame.protocol)
        if (mismatch !== undefined) {
          refuse({ socket, reason: mismatch })
          return
        }
        socket.data.helloed = true
        if (frame.threadId === threadId) {
          void greet({ socket, hello: frame })
          return
        }
        void admitsThread({ served: threadId, requested: frame.threadId, authority: args.authority }).then((admitted) => {
          if (!live.has(socket)) return
          if (admitted) greet({ socket, hello: frame })
          else refuse({ socket, reason: 'this sandbox serves one thread' })
        })
        return
      }

      if (!socket.data.helloed) {
        refuse({ socket, reason: 'the first frame must be hello' })
        return
      }

      if (!socket.data.greeted) {
        socket.data.held.push(frame)
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

    broadcastPrStates() {
      const frame: ServeFrame = {
        kind: EServeFrame.PrStates,
        states: prStatesWireSchema.parse({ states: prStatesSnapshot() }).states,
      }
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

    abortHistory: () => router.compaction.abortAll(),

    clients: () => attached.size,
    settling: () => router.state.restoring !== null || mutations.active(),
    whenSettled: async () => {
      await router.state.restoring
      await router.compaction.whenSettled()
      await router.rotation.whenSettled()
      await mutations.whenSettled()
    },
  }
}
