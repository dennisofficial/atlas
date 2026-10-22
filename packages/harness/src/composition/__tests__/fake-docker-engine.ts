import type { DockerEngine } from '@dltech/atlas-harness'

export type FakeContainer = {
  id: string
  labels: Record<string, string>
  binds: readonly string[]
  workingDir: string
}

export const statefulEngine = () => {
  const containers: FakeContainer[] = []
  const removals: string[] = []
  let failListing = false

  const engine = {
    info: async () => ({ cpus: 64, memoryBytes: 1024 ** 4 }),
    listContainers: async (query: { labels: Record<string, string | undefined> }) => {
      if (failListing) throw new Error('daemon dropped the listing')
      return containers
        .filter((one) =>
          Object.entries(query.labels).every(([key, value]) => one.labels[key] === value),
        )
        .map((one) => ({ id: one.id, name: one.id, state: 'running', labels: one.labels }))
    },
    inspectContainer: async (args: { id: string }) => {
      const found = containers.find((one) => one.id === args.id)
      return {
        id: args.id,
        name: args.id,
        state: { running: true },
        config: { labels: found?.labels ?? {}, env: [], image: 'node:22-slim' },
        mounts: [],
        ports: [],
        hostConfig: { nanoCpus: 0, memoryBytes: 0 },
      }
    },
    listNetworks: async () => [{ id: 'net', name: 'net', labels: {} }],
    createNetwork: async () => ({ id: 'net' }),
    removeNetwork: async () => undefined,
    createContainer: async (args: {
      body: {
        Labels?: Record<string, string>
        HostConfig?: { Binds?: readonly string[] }
        WorkingDir?: string
      }
    }) => {
      const id = `container-${containers.length + removals.length + 1}`
      containers.push({
        id,
        labels: args.body.Labels ?? {},
        binds: args.body.HostConfig?.Binds ?? [],
        workingDir: args.body.WorkingDir ?? '',
      })
      return { id, warnings: [] }
    },
    removeContainer: async (args: { id: string }) => {
      removals.push(args.id)
      const at = containers.findIndex((one) => one.id === args.id)
      if (at !== -1) containers.splice(at, 1)
    },
    stopContainer: async () => undefined,
    startContainer: async () => undefined,
    createExec: async () => ({ id: 'exec' }),
    startExec: async () =>
      new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
    inspectExec: async () => ({ running: false, exitCode: 0 }),
    images: { listImages: async () => [], buildImage: async () => undefined },
  }

  return {
    engine: engine as unknown as DockerEngine,
    containers,
    removals,
    failListing: () => {
      failListing = true
    },
  }
}
