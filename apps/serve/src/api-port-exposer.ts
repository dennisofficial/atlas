import { type ApiRemote, controlPlaneError, createApiClient } from './api-client'
import { ensureCloudflared, type CloudflaredHost } from './cloudflared'

export type PortExposer = { exposePort: (args: { port: number }) => Promise<string> }

export const apiPortExposer = (args: {
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn?: typeof fetch | undefined
  cloudflaredHost?: CloudflaredHost | undefined
}): PortExposer => {
  const { cloudflaredHost, ...rest } = args
  const remote: ApiRemote = { ...rest, fetchFn: args.fetchFn ?? fetch }
  return {
    exposePort: async ({ port }) => {
      const reply = await createApiClient(remote)
        .sandboxSelf.exposePort.mutate({ port })
        .catch((failure: unknown) => {
          throw controlPlaneError(failure)
        })
      await ensureCloudflared({ token: reply.tunnelToken, host: cloudflaredHost })
      return reply.url
    },
  }
}
