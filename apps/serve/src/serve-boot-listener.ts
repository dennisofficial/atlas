import type { Server } from 'bun'

import type { ThreadId } from '@dltech/atlas-core'

import { SERVE_CAPABILITIES } from '@dltech/atlas-wire'

import { EWorkspaceState, type WorkspaceReadiness } from './materialize-workspace'
import type { ServeDrain } from './serve-drain'
import { EServeEvent, type ServeLog } from './serve-log'
import { startSessionServer } from './session-server'
import type { SessionHandlers, SocketState } from './socket-session'

export type BootedHealthArgs = {
  workspace: WorkspaceReadiness
  clients: () => number
  work: () => Record<string, unknown>
  nextSeq: () => number
  resumable: boolean
}

export type BootListener = {
  server: Server<SocketState>
  port: number
  complete: (given: {
    handlers: SessionHandlers
    drain: ServeDrain
    health: BootedHealthArgs
  }) => void
  /** Closes every socket held while booting with an error instead of leaving it hung. */
  fail: (given: { reason: string }) => void
}

const bootingHealth = (args: {
  threadId: ThreadId
  sandboxSessionId: string
  startedAt: number
}): unknown => ({
  ok: true,
  booting: true,
  capabilities: SERVE_CAPABILITIES,
  rotationPreparationVersion: 1,
  sandboxSessionId: args.sandboxSessionId,
  threadId: args.threadId,
  uptimeMs: Date.now() - args.startedAt,
  busy: false,
  childrenRunning: 0,
  shellsRunning: 0,
  servicesRunning: 0,
  pendingInput: false,
  settlingWork: false,
  clients: 0,
})

const bootedHealth = (args: {
  base: BootedHealthArgs
  threadId: ThreadId
  sandboxSessionId: string
  startedAt: number
}): unknown => ({
  ok: args.base.workspace.state !== EWorkspaceState.Failed,
  capabilities: SERVE_CAPABILITIES,
  rotationPreparationVersion: 1,
  sandboxSessionId: args.sandboxSessionId,
  threadId: args.threadId,
  uptimeMs: Date.now() - args.startedAt,
  clients: args.base.clients(),
  ...args.base.work(),
  nextSeq: args.base.nextSeq(),
  resumable: args.base.resumable,
  workspace: args.base.workspace,
})

export function listenWhileBooting(args: {
  port: number
  token: string
  threadId: ThreadId
  sandboxSessionId: string
  startedAt: number
  log: ServeLog
  /** Settled once the app exists; asked whether a ticketed thread is one of the served family. */
  admitsThread?: ((threadId: string) => Promise<boolean>) | undefined
}): BootListener {
  let installed:
    | { handlers: SessionHandlers; drain: ServeDrain; health: BootedHealthArgs }
    | undefined

  const { server, handshake } = startSessionServer({
    port: args.port,
    token: args.token,
    threadId: args.threadId,
    handlers: () => installed?.handlers,
    drain: () => installed?.drain,
    ...(args.admitsThread === undefined ? {} : { admitsThread: args.admitsThread }),
    health: () =>
      installed === undefined
        ? bootingHealth({
            threadId: args.threadId,
            sandboxSessionId: args.sandboxSessionId,
            startedAt: args.startedAt,
          })
        : bootedHealth({
            base: installed.health,
            threadId: args.threadId,
            sandboxSessionId: args.sandboxSessionId,
            startedAt: args.startedAt,
          }),
  })
  const port = server.port ?? args.port
  args.log({
    event: EServeEvent.Listening,
    threadId: args.threadId,
    port,
    ms: Date.now() - args.startedAt,
  })

  return {
    server,
    port,
    complete: (given) => {
      installed = given
      handshake.flush({ handlers: given.handlers })
    },
    fail: ({ reason }) => handshake.drop({ reason }),
  }
}
