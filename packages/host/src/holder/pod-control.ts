import type { ThreadId } from '@dltech/atlas-core'
import type { PodControl } from '@dltech/atlas-plugin-sdk'

export type PodControlClient = {
  exposePort(args: {
    threadId: string
    port: number
    signal?: AbortSignal | undefined
  }): Promise<{ url: string; tunnelToken: string }>
}

export const podControlOf = (args: {
  client: PodControlClient | undefined
  threadId: ThreadId
}): PodControl => ({
  exposePort: async ({ port }) => {
    if (args.client === undefined) throw new Error('this session cannot reach the control plane')
    try {
      return await args.client.exposePort({ threadId: args.threadId, port })
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure)
      throw new Error(`could not expose port ${port}: ${message}`)
    }
  },
})
