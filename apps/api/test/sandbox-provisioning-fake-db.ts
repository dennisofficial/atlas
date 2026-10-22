import { applyUpdate, matchesValue, project, uniqueViolation, type Where } from './fake-db-support'

export type ProvisioningThreadRow = {
  id: string
  userId: string
  head: number
  createdAt: string
  updatedAt: string
  modelRef: string | null
  executionLocation: string | null
  projectId: string | null
}

export type ProvisioningEventRow = {
  id: string
  threadId: string
  seq: number
  runId: string
  type: string
  body: string
  userId: string
}

export type ProvisioningSandboxRow = {
  id: string
  threadId: string
  userId: string
  name: string
  state: string
  serveUrl: string | null
  tokenHash: string
  sealedToken: string | null
  wakeClaim: string | null
  wakeFailedAt: string | null
  pendingSend: unknown
  runtimeCheckpoint: unknown
  runtimeCheckpointRevision: number | null
} & Where

const matches = (row: object, where: Where | undefined): boolean =>
  where === undefined ||
  Object.entries(where).every(([key, condition]) => matchesValue((row as Where)[key], condition))

export function createProvisioningFakeDb() {
  const threads: ProvisioningThreadRow[] = []
  const events: ProvisioningEventRow[] = []
  const sandboxes: ProvisioningSandboxRow[] = []

  const threadTable = {
    findFirst: async (args: { where: Where }) => {
      const row = threads.find((one) => matches(one, args.where))
      return row === undefined ? null : { ...row }
    },
    findUnique: async (args: { where: { id: string }; select?: Record<string, boolean> }) => {
      const row = threads.find((one) => one.id === args.where.id)
      return row === undefined ? null : project({ ...row }, args.select)
    },
    update: async (args: {
      where: { id: string }
      data: Where
      select?: Record<string, boolean>
    }) => {
      const row = threads.find((one) => one.id === args.where.id)
      if (row === undefined) throw new Error('fake thread.update: no row')
      applyUpdate(row as unknown as Record<string, unknown>, args.data)
      return project(row, args.select)
    },
  }

  const eventTable = {
    findMany: async (args: { where?: Where }) => events.filter((row) => matches(row, args.where)),
    createMany: async (args: { data: ProvisioningEventRow[] }) => {
      events.push(...args.data)
      return { count: args.data.length }
    },
  }

  const sandboxTable = {
    findUnique: async (args: { where: { threadId: string } }) => {
      const row = sandboxes.find((one) => one.threadId === args.where.threadId)
      return row === undefined ? null : { ...row }
    },
    create: async (args: { data: ProvisioningSandboxRow }) => {
      if (sandboxes.some((row) => row.threadId === args.data.threadId)) {
        throw uniqueViolation(['threadId'])
      }
      const row: ProvisioningSandboxRow = {
        ...args.data,
        serveUrl: args.data.serveUrl ?? null,
        wakeFailedAt: args.data.wakeFailedAt ?? null,
        wakeClaim: args.data.wakeClaim ?? null,
        pendingSend: args.data.pendingSend ?? null,
        runtimeCheckpoint: args.data.runtimeCheckpoint ?? null,
        runtimeCheckpointRevision: args.data.runtimeCheckpointRevision ?? null,
      }
      sandboxes.push(row)
      return row
    },
    update: async (args: { where: { threadId: string }; data: Where }) => {
      const row = sandboxes.find((one) => one.threadId === args.where.threadId)
      if (row === undefined) throw new Error('fake cloudSandbox.update: no row')
      applyUpdate(row, args.data)
      return row
    },
    updateMany: async (args: { where?: Where; data: Where }) => {
      const matched = sandboxes.filter((row) => matches(row, args.where))
      for (const row of matched) applyUpdate(row, args.data)
      return { count: matched.length }
    },
  }

  const db = {
    thread: threadTable,
    event: eventTable,
    cloudSandbox: sandboxTable,
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db),
  }

  return {
    db,
    threads,
    events,
    sandboxes,
    reset: () => {
      threads.length = 0
      events.length = 0
      sandboxes.length = 0
    },
  }
}

export type ProvisioningFakeDb = ReturnType<typeof createProvisioningFakeDb>

let current: ProvisioningFakeDb | undefined

export function provisioningFakeDb(): ProvisioningFakeDb {
  current ??= createProvisioningFakeDb()
  return current
}
