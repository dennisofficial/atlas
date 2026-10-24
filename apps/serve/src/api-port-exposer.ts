import { type ApiRemote, controlPlaneError, createApiClient } from './api-client'

export type PortExposer = { exposePort: (args: { port: number }) => Promise<string> }

export const apiPortExposer = (args: {
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn?: typeof fetch | undefined
}): PortExposer => {
  const remote: ApiRemote = { ...args, fetchFn: args.fetchFn ?? fetch }
  return {
    exposePort: async ({ port }) => {
      try {
        const reply = await createApiClient(remote).sandboxSelf.exposePort.mutate({ port })
        return reply.url
      } catch (failure) {
        throw controlPlaneError(failure)
      }
    },
  }
}
