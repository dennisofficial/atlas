import { SANDBOX_SERVE_PORT } from '../constants'
import type { DaemonEndpoint } from '../sandbox-provider'

import type { Agent37Client } from './agent37-client'

export const AGENT37_DAEMON_PORT = SANDBOX_SERVE_PORT
export const AGENT37_SIGNED_TTL_SECONDS = 7 * 24 * 60 * 60

// https://www.agent37.com/docs/agents-api/urls — every port answers at
// `https://{instanceId}-{port}.agent37.app`, and WebSocket upgrades pass through. The host's
// connector cannot set request headers, so the socket authenticates with a signed URL whose
// `a37_token` the edge consumes; our own daemon token still rides the hello frame.
export const agent37EndpointOf = async (args: {
  client: Agent37Client
  instanceId: string
  token: string
  sandboxName: string
}): Promise<DaemonEndpoint> => {
  const signed = await args.client.signedUrl({
    id: args.instanceId,
    port: AGENT37_DAEMON_PORT,
    ttlSeconds: AGENT37_SIGNED_TTL_SECONDS,
  })
  return {
    url: signed.replace(/^https:/, 'wss:'),
    token: args.token,
    sandboxName: args.sandboxName,
  }
}
