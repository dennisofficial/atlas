import { SANDBOX_SELF_PORTS_PATH, sandboxExposePortReplySchema } from '@dltech/atlas-wire'

import { postSandboxSelf } from './sandbox-self-client'

export type PortExposer = { exposePort: (args: { port: number }) => Promise<string> }

export const apiPortExposer = (args: {
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn?: typeof fetch | undefined
}): PortExposer => ({
  exposePort: async ({ port }) => {
    const response = await postSandboxSelf({
      controlPlaneUrl: args.controlPlaneUrl,
      path: SANDBOX_SELF_PORTS_PATH,
      token: args.token,
      clientVersion: args.clientVersion,
      fetchFn: args.fetchFn ?? fetch,
      body: { port },
    })
    return sandboxExposePortReplySchema.parse(await response.json()).url
  },
})
