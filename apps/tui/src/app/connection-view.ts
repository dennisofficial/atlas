import type { SessionStatusOutput } from '@dltech/atlas-protocol'
import { ESandboxStatus } from '@dltech/atlas-protocol'
import { ESessionConnection } from '@dltech/atlas-client/stream'

export type ConnectionView = {
  cloudConnected: boolean
  reconnecting: boolean
  disconnected: boolean
  waking: boolean
  stale: boolean
}

const ASLEEP = new Set<ESandboxStatus>([ESandboxStatus.Sleeping, ESandboxStatus.Waking])

export const connectionViewOf = (args: {
  connection: ESessionConnection
  status: SessionStatusOutput | undefined
}): ConnectionView => {
  const sandbox = args.status?.sandbox

  return {
    cloudConnected:
      args.connection === ESessionConnection.Live ||
      args.connection === ESessionConnection.CatchingUp,
    reconnecting: args.connection === ESessionConnection.Reconnecting,
    disconnected: args.connection === ESessionConnection.Offline,
    waking: sandbox !== null && sandbox !== undefined && ASLEEP.has(sandbox.status),
    stale: args.connection === ESessionConnection.CatchingUp,
  }
}
