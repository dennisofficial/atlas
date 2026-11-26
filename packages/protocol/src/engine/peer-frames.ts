import { EDaemonErrorKind, daemonFrameSchema, type DaemonFrame } from '../frames'
import { ECloseCode, type EngineConnection } from './connection'

export type Peer = { connection: EngineConnection; epoch: number | null; live: boolean }

export type PeerFaults = { onFault(args: { error: unknown }): void }

export const sendFrame = (args: PeerFaults & { peer: Peer; frame: DaemonFrame }): void => {
  if (!args.peer.live) return
  const checked = daemonFrameSchema.safeParse(args.frame)
  if (!checked.success) {
    args.onFault({
      error: new Error(`refusing to send ${args.frame.kind}: ${checked.error.message}`),
    })
    return
  }
  args.peer.connection.send(JSON.stringify(checked.data))
}

export const sendErrorFrame = (
  args: PeerFaults & {
    peer: Peer
    errorKind: EDaemonErrorKind
    message: string
    key?: string | undefined
  },
): void => {
  sendFrame({
    onFault: args.onFault,
    peer: args.peer,
    frame: {
      kind: 'error',
      ...(args.key === undefined ? {} : { key: args.key }),
      errorKind: args.errorKind,
      message: args.message,
    },
  })
}

export const rejectPeer = (
  args: PeerFaults & {
    peer: Peer
    code: ECloseCode
    errorKind: EDaemonErrorKind
    message: string
  },
): void => {
  sendErrorFrame(args)
  args.peer.live = false
  args.peer.connection.close({ code: args.code, reason: args.message })
}
