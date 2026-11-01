import {
  capabilitySetOf,
  downgradeServeFrame,
  encodeFrame,
  speaksModelAvailability,
  type CapabilitySet,
} from '@dltech/atlas-wire'
import type { ServeFrame } from '@dltech/atlas-harness'

import type { SessionSocket } from './socket-session-types'

const NO_CAPABILITIES: CapabilitySet = capabilitySetOf(undefined)

export const peerCapabilitiesOf = (socket: SessionSocket): CapabilitySet =>
  socket.data.capabilities ?? NO_CAPABILITIES

export const encodeForPeer = (args: { frame: ServeFrame; capabilities: CapabilitySet }): string =>
  encodeFrame(downgradeServeFrame(args))

export const createBroadcastEncoder = (frame: ServeFrame) => {
  const encoded = new Map<boolean, string>()
  return (socket: SessionSocket): string => {
    const capabilities = peerCapabilitiesOf(socket)
    const capable = speaksModelAvailability(capabilities)
    const held = encoded.get(capable)
    if (held !== undefined) return held
    const fresh = encodeForPeer({ frame, capabilities })
    encoded.set(capable, fresh)
    return fresh
  }
}

export const sendFrame = (args: { socket: SessionSocket; frame: ServeFrame }): void =>
  void args.socket.send(
    encodeForPeer({ frame: args.frame, capabilities: peerCapabilitiesOf(args.socket) }),
  )
