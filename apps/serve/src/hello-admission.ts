import type { ThreadId } from '@dltech/atlas-core'
import { CHANNEL_PROTOCOL_VERSION } from '@dltech/atlas-harness'

import type { ServeSessionAuthority } from './serve-app'

export const protocolRefusal = (protocol: number | undefined): string | undefined => {
  if (protocol === undefined || protocol === CHANNEL_PROTOCOL_VERSION) return undefined
  return protocol > CHANNEL_PROTOCOL_VERSION
    ? `this Atlas speaks a newer wire protocol (${protocol}) than this sandbox's serve (${CHANNEL_PROTOCOL_VERSION}) — re-open the conversation so the sandbox's serve is rebuilt`
    : `this Atlas speaks an older wire protocol (${protocol}) than this sandbox's serve (${CHANNEL_PROTOCOL_VERSION}) — update Atlas, then re-open the conversation`
}

export const admitsThread = async (args: {
  served: ThreadId
  requested: ThreadId
  authority: ServeSessionAuthority | undefined
}): Promise<boolean> => {
  if (args.requested === args.served) return true
  if (args.authority === undefined) return false
  const generation = await args.authority.mainGenerationOf({ threadId: args.requested }).catch(() => undefined)
  return generation !== undefined
}
