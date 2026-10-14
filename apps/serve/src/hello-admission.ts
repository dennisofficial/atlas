import { CHANNEL_PROTOCOL_VERSION } from '@dltech/atlas-harness'

export const protocolRefusal = (protocol: number | undefined): string | undefined => {
  if (protocol === undefined || protocol === CHANNEL_PROTOCOL_VERSION) return undefined
  return protocol > CHANNEL_PROTOCOL_VERSION
    ? `this Atlas speaks a newer wire protocol (${protocol}) than this sandbox's serve (${CHANNEL_PROTOCOL_VERSION}) — re-open the conversation so the sandbox's serve is rebuilt`
    : `this Atlas speaks an older wire protocol (${protocol}) than this sandbox's serve (${CHANNEL_PROTOCOL_VERSION}) — update Atlas, then re-open the conversation`
}
