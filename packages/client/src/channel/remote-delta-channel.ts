import { saidBody } from '@dltech/atlas-core'

import { EClientFrame, toSendId } from './channel-wire'
import { EConnectionView, ESocketLiveness } from './connection-view'
import { createChannelCore } from './remote-channel-core'
import { createChannelLifecycle } from './remote-channel-lifecycle'
import { NOTHING_IN_FLIGHT } from './remote-channel-in-flight'
import { RemotePublishRefused, RemoteRequestLost } from './remote-channel-upstream'
import type {
  RemoteDeltaChannel,
  RemoteDeltaChannelOptions,
  TerminalFrameChannel,
} from './remote-delta-channel-types'

export {
  RemotePublishRefused,
  RemoteRequestFailed,
  RemoteRequestLost,
} from './remote-channel-upstream'
export type {
  ChannelSocket,
  ChannelSocketFactory,
  ChannelSocketHandlers,
} from './remote-channel-socket'
export * from './remote-delta-channel-types'
export type { RuntimeCheckpoint } from '@dltech/atlas-wire/web'

export function createRemoteDeltaChannel(
  args: RemoteDeltaChannelOptions,
): RemoteDeltaChannel & TerminalFrameChannel {
  const core = createChannelCore(args)
  const { state, on, facts, upstream, checkpoints, inFlight, listeners } = core
  const lifecycle = createChannelLifecycle(core)

  if (core.attached) lifecycle.connect()

  return {
    threadId: args.threadId,

    subscribe({ threadId, listener }) {
      if (threadId !== args.threadId) return () => undefined
      for (const signal of inFlight.replay()) listener(signal)
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    snapshot: ({ threadId }) =>
      threadId === args.threadId ? inFlight.replay() : NOTHING_IN_FLIGHT,

    publisherFor({ threadId }) {
      throw new RemotePublishRefused(threadId)
    },

    send: ({ text, requestId, images, files, context }) => {
      lifecycle.kickWake()
      upstream.send({
        kind: EClientFrame.Send,
        sendId: toSendId(crypto.randomUUID()),
        ...saidBody({ text, requestId, images, files }),
        ...(context === undefined || context.length === 0 ? {} : { context: [...context] }),
      })
    },

    run: (runArgs) => {
      lifecycle.kickWake()
      upstream.send({
        kind: EClientFrame.Run,
        ...(runArgs?.resume === true ? { resume: true } : {}),
      })
    },

    interrupt: core.requestInterrupt,
    pause: () => upstream.send({ kind: EClientFrame.Pause }),
    resume: () => upstream.send({ kind: EClientFrame.Resume }),

    request: (request) => {
      if (state.abandoned) {
        return Promise.reject(
          new RemoteRequestLost({ op: request.op, reason: 'the channel is closed' }),
        )
      }
      const parked = facts.view().state === EConnectionView.Parked
      if (parked && args.wakeSandbox === undefined) {
        return Promise.reject(
          new RemoteRequestLost({ op: request.op, reason: 'the sandbox is parked' }),
        )
      }
      lifecycle.kickWake()
      return upstream.request(request)
    },

    connection: () => facts.view(),
    onConnection: (listener) => facts.onView(listener),
    onReload: (listener) => on.reloads.add(listener),
    onReady: (listener) => on.readies.add(listener),
    capabilities: () => state.capabilities,
    onInterruptAck: (listener) => on.interruptAcks.add(listener),
    onRoster: (listener) => on.rosters.add(listener),
    onPrStates: (listener) => on.prStates.add(listener),
    onSubscriptions: (listener) => on.subscriptions.add(listener),
    onTerminalOutput: (listener) => on.terminalOutputs.add(listener),
    onTerminalExit: (listener) => on.terminalExits.add(listener),
    pendingEntries: () => state.heldPending,
    onPendingChanged: (listener) => on.pendingChanges.add(listener),
    onThreadRenamed: (listener) => on.threadRenames.add(listener),
    onThreadTitling: (listener) => on.threadTitlings.add(listener),
    onThreadModelChanged: (listener) => on.threadModelChanges.add(listener),
    onTurnEnded: (listener) => on.turnEndings.add(listener),
    onError: (listener) => on.failures.add(listener),
    onServerError: (listener) => on.serverErrors.add(listener),
    checkpoint: () => checkpoints.current(),
    onCheckpoint: (listener) => checkpoints.onCheckpoint(listener),

    observeCheckpoint(checkpoint) {
      if (state.abandoned) return
      core.acceptCheckpoint(checkpoint)
    },

    attachment() {
      if (state.url === undefined || state.token === undefined) return undefined
      return { url: state.url, token: state.token }
    },

    wake(next) {
      if (state.abandoned) return
      lifecycle.applyAttachment(next)
    },

    beginWake() {
      if (state.abandoned || facts.facts().socket === ESocketLiveness.Open) return
      facts.update({ waking: true, failure: null })
    },

    beginRotation() {
      if (state.abandoned || facts.facts().socket === ESocketLiveness.Open) return
      facts.update({ rotating: true })
    },

    failWake({ reason }) {
      if (state.abandoned) return
      lifecycle.failWake(reason)
    },

    reconnect() {
      if (state.abandoned) return
      const current = facts.facts()
      if (current.socket === ESocketLiveness.Open || current.waking) return
      lifecycle.startWake()
    },

    unackedSendCount: () => upstream.unackedSendCount(),

    detach() {
      if (state.abandoned) return
      lifecycle.shutDown({
        reason: 'the channel detached',
        beforeAbandon: () => {
          checkpoints.forget()
          inFlight.forget()
        },
      })
      on.detachments.emit('The session detached from the sandbox turn.')
      facts.update({ detached: true, waking: false })
    },

    onDetached: (listener) => on.detachments.add(listener),

    close() {
      lifecycle.shutDown({ reason: 'the channel was closed', beforeAbandon: core.endStrandedStep })
      facts.update({ detached: true, waking: false })
    },
  }
}
