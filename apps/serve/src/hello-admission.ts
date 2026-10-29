import {
  CHANNEL_PROTOCOL_MIN_VERSION,
  CHANNEL_PROTOCOL_VERSION,
  EProtocolSkew,
  protocolSkewOf,
  type ProtocolRange,
} from '@dltech/atlas-wire'

const SERVE_RANGE = `${CHANNEL_PROTOCOL_MIN_VERSION}–${CHANNEL_PROTOCOL_VERSION}`

export const protocolRefusal = (peer: ProtocolRange): string | undefined => {
  const skew = protocolSkewOf(peer)
  if (skew === EProtocolSkew.Compatible) return undefined
  return skew === EProtocolSkew.PeerTooNew
    ? `this Atlas speaks a newer wire protocol (${peer.protocol}) than this sandbox's serve (${SERVE_RANGE}) — re-open the conversation so the sandbox's serve is rebuilt`
    : `this Atlas speaks an older wire protocol (${peer.protocol}) than this sandbox's serve (${SERVE_RANGE}) — update Atlas, then re-open the conversation`
}
