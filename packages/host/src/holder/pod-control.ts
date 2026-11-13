import type { ThreadId } from '@dltech/atlas-core'
import { EMPTY_MCP_CONTROL } from '@dltech/atlas-plugin-sdk'
import type {
  MemoryAddress,
  MemoryEntry,
  MemoryKind,
  MemorySnapshot,
  MemorySummary,
  PodControl,
  PodMcpControl,
  WebSearchConfig,
} from '@dltech/atlas-plugin-sdk'

type Called = { threadId: string; signal?: AbortSignal | undefined }

export type PodControlClient = {
  exposePort(args: {
    threadId: string
    port: number
    signal?: AbortSignal | undefined
  }): Promise<{ url: string; tunnelToken: string }>
  webSearch: {
    config(args: Called): Promise<WebSearchConfig>
  }
  memory: {
    list(args: Called): Promise<MemorySnapshot>
    read(args: Called & MemoryAddress): Promise<MemoryEntry | null>
    write(
      args: Called & MemoryAddress & { description: string; type: MemoryKind; body: string },
    ): Promise<MemorySummary>
    edit(
      args: Called & MemoryAddress & { old: string; new: string; revision: number },
    ): Promise<MemorySummary>
    remove(args: Called & MemoryAddress): Promise<boolean>
  }
}

const unreachable = (): Error => new Error('this session cannot reach the control plane')

export const podControlOf = (args: {
  client: PodControlClient | undefined
  threadId: ThreadId
  mcp?: PodMcpControl | undefined
}): PodControl => ({
  exposePort: async ({ port }) => {
    if (args.client === undefined) throw unreachable()
    try {
      return await args.client.exposePort({ threadId: args.threadId, port })
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure)
      throw new Error(`could not expose port ${port}: ${message}`)
    }
  },
  mcp: args.mcp ?? EMPTY_MCP_CONTROL,
  webSearch: {
    config: async () => {
      if (args.client === undefined) throw unreachable()
      return await args.client.webSearch.config({ threadId: args.threadId })
    },
  },
  memory: {
    list: async () => {
      if (args.client === undefined) throw unreachable()
      return await args.client.memory.list({ threadId: args.threadId })
    },
    read: async (address) => {
      if (args.client === undefined) throw unreachable()
      return await args.client.memory.read({ threadId: args.threadId, ...address })
    },
    write: async (write) => {
      if (args.client === undefined) throw unreachable()
      return await args.client.memory.write({ threadId: args.threadId, ...write })
    },
    edit: async (edit) => {
      if (args.client === undefined) throw unreachable()
      return await args.client.memory.edit({ threadId: args.threadId, ...edit })
    },
    delete: async (address) => {
      if (args.client === undefined) throw unreachable()
      return await args.client.memory.remove({ threadId: args.threadId, ...address })
    },
  },
})
