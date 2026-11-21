import type { ThreadId } from '@dltech/atlas-core'
import { EMPTY_MCP_CONTROL } from '@dltech/atlas-plugin-sdk'
import type {
  ECloudSetting,
  MemoryAddress,
  MemoryEntry,
  MemoryKind,
  MemorySnapshot,
  MemorySummary,
  PodControl,
  PodMcpControl,
  PodRoutineInput,
  PodRoutines,
  WebSearchConfig,
} from '@dltech/atlas-plugin-sdk'
import type {
  Routine,
  RoutineRemoveOutput,
  RoutineRunOutput,
  RoutineUpdateInput,
} from '@dltech/atlas-protocol'

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
  settingsVersions(args: Called): Promise<Readonly<Record<ECloudSetting, string>>>
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
  routines: {
    list(args: Called): Promise<readonly Routine[]>
    get(args: Called & { routineId: string }): Promise<Routine>
    create(args: Called & PodRoutineInput): Promise<Routine>
    update(args: Called & RoutineUpdateInput): Promise<Routine>
    remove(args: Called & { routineId: string }): Promise<RoutineRemoveOutput>
    run(args: Called & { routineId: string }): Promise<RoutineRunOutput>
  }
}

const unreachable = (): Error => new Error('this session cannot reach the control plane')

const routinesOf = (args: {
  client: PodControlClient | undefined
  threadId: ThreadId
}): PodRoutines => ({
  list: async () => {
    if (args.client === undefined) throw unreachable()
    return await args.client.routines.list({ threadId: args.threadId })
  },
  get: async ({ routineId }) => {
    if (args.client === undefined) throw unreachable()
    return await args.client.routines.get({ threadId: args.threadId, routineId })
  },
  create: async (input) => {
    if (args.client === undefined) throw unreachable()
    return await args.client.routines.create({ threadId: args.threadId, ...input })
  },
  update: async (input) => {
    if (args.client === undefined) throw unreachable()
    return await args.client.routines.update({ threadId: args.threadId, ...input })
  },
  remove: async ({ routineId }) => {
    if (args.client === undefined) throw unreachable()
    return await args.client.routines.remove({ threadId: args.threadId, routineId })
  },
  run: async ({ routineId }) => {
    if (args.client === undefined) throw unreachable()
    return await args.client.routines.run({ threadId: args.threadId, routineId })
  },
})

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
  settingsVersions: async () => {
    if (args.client === undefined) throw unreachable()
    return await args.client.settingsVersions({ threadId: args.threadId })
  },
  mcp: args.mcp ?? EMPTY_MCP_CONTROL,
  routines: routinesOf({ client: args.client, threadId: args.threadId }),
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
