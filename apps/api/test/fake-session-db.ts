import { applyUpdate, matchesValue, project, sortRows, type Where } from './fake-db-support'

export type FakeThreadRow = {
  id: string
  title: string | null
  head: number
  createdAt: string
  updatedAt: string
  parentThreadId: string | null
  forkSeq: number | null
  forkMode: string | null
  spawnerThreadId: string | null
  agentType: string | null
  workspace: string | null
  repo: string | null
  modelRef: string | null
  modelEffort: string | null
  executionLocation: string | null
  userId: string
}

export type FakeEventRow = {
  id: string
  threadId: string
  seq: number
  runId: string
  parentRunId: string | null
  depth: number
  at: string
  type: string
  body: string
  contextSlot: string | null
  contextKey: string | null
  contextDigest: string | null
  userId: string
}

export type FakeTurnRow = {
  runId: string
  threadId: string
  status: string
  providerId: string
  modelId: string
  steps: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  startedAt: string
  endedAt: string
  durationMs: number
  userId: string
}

export type FakeCloudSandboxRow = {
  id: string
  threadId: string
  userId: string
  sandboxId: string
  name: string
  region: string
  state: string
  lastActivityAt: string
  tokenHash: string
  sealedToken: string | null
  workspaceRemoteUrl: string | null
  workspaceBranch: string | null
  workspaceCommit: string | null
  workspacePatch: string | null
  createdAt: string
  updatedAt: string
}

type FakeRow = FakeThreadRow | FakeEventRow | FakeTurnRow | FakeCloudSandboxRow

export function createFakeSessionDb() {
  const threads: FakeThreadRow[] = []
  const events: FakeEventRow[] = []
  const turns: FakeTurnRow[] = []
  const cloudSandboxes: FakeCloudSandboxRow[] = []

  const matchesRow = (row: FakeRow, where: Where): boolean =>
    Object.entries(where).every(([key, condition]) => {
      if (key === 'OR') {
        return (condition as Where[]).some((branch) => matchesRow(row, branch))
      }
      if (key === 'forks' || key === 'spawned') {
        const relationKey = key === 'forks' ? 'parentThreadId' : 'spawnerThreadId'
        const some = (condition as { some?: unknown }).some !== undefined
        const found = threads.some(
          (thread) => (thread as unknown as Where)[relationKey] === (row as FakeThreadRow).id,
        )
        return some ? found : !found
      }
      return matchesValue((row as unknown as Where)[key], condition)
    })

  const db = {
    thread: {
      create: async (args: { data: Where }) => {
        const row: FakeThreadRow = {
          title: null,
          head: 0,
          parentThreadId: null,
          forkSeq: null,
          forkMode: null,
          spawnerThreadId: null,
          agentType: null,
          workspace: null,
          repo: null,
          modelRef: null,
          modelEffort: null,
          executionLocation: null,
          ...(args.data as Partial<FakeThreadRow>),
        } as FakeThreadRow
        threads.push(row)
        return row
      },
      findUnique: async (args: { where: { id: string }; select?: Record<string, boolean> }) => {
        const row = threads.find((one) => one.id === args.where.id) ?? null
        return row === null ? null : project(row, args.select)
      },
      findUniqueOrThrow: async (args: { where: { id: string } }) => {
        const row = threads.find((one) => one.id === args.where.id)
        if (row === undefined) throw new Error('record not found')
        return row
      },
      findFirst: async (args: { where: Where; orderBy?: unknown }) => {
        const matched = threads.filter((one) => matchesRow(one, args.where))
        const sorted = args.orderBy === undefined ? matched : sortRows(matched, args.orderBy)
        return sorted[0] ?? null
      },
      findMany: async (args: { where?: Where; orderBy?: unknown; take?: number }) => {
        const matched = threads.filter(
          (one) => args.where === undefined || matchesRow(one, args.where),
        )
        const sorted = args.orderBy === undefined ? matched : sortRows(matched, args.orderBy)
        return args.take === undefined ? sorted : sorted.slice(0, args.take)
      },
      update: async (args: { where: { id: string }; data: Where; select?: Record<string, boolean> }) => {
        const row = threads.find((one) => one.id === args.where.id)
        if (row === undefined) throw new Error('record not found')
        applyUpdate(row as unknown as Record<string, unknown>, args.data)
        return project(row, args.select)
      },
      updateMany: async (args: { where: Where; data: Where }) => {
        const matched = threads.filter((one) => matchesRow(one, args.where))
        for (const row of matched) applyUpdate(row as unknown as Record<string, unknown>, args.data)
        return { count: matched.length }
      },
      deleteMany: async (args: { where: Where }) => {
        const kept = threads.filter((one) => !matchesRow(one, args.where))
        const count = threads.length - kept.length
        threads.splice(0, threads.length, ...kept)
        return { count }
      },
    },
    event: {
      create: async (args: { data: FakeEventRow }) => {
        events.push(args.data)
        return args.data
      },
      createMany: async (args: { data: FakeEventRow[] }) => {
        events.push(...args.data)
        return { count: args.data.length }
      },
      findMany: async (args: { where?: Where; orderBy?: unknown; select?: Record<string, boolean> }) => {
        const matched = events.filter(
          (one) => args.where === undefined || matchesRow(one, args.where),
        )
        const sorted = args.orderBy === undefined ? matched : sortRows(matched, args.orderBy)
        return sorted.map((row) => project(row, args.select))
      },
      findFirst: async (args: { where: Where; orderBy?: unknown; select?: Record<string, boolean> }) => {
        const matched = events.filter((one) => matchesRow(one, args.where))
        const sorted = args.orderBy === undefined ? matched : sortRows(matched, args.orderBy)
        const first = sorted[0] ?? null
        return first === null ? null : project(first, args.select)
      },
      deleteMany: async (args: { where: Where }) => {
        const kept = events.filter((one) => !matchesRow(one, args.where))
        const count = events.length - kept.length
        events.splice(0, events.length, ...kept)
        return { count }
      },
    },
    turn: {
      upsert: async (args: { where: { runId: string }; create: FakeTurnRow; update: Where }) => {
        const existing = turns.find((one) => one.runId === args.where.runId)
        if (existing === undefined) {
          turns.push(args.create)
          return args.create
        }
        applyUpdate(existing as unknown as Record<string, unknown>, args.update)
        return existing
      },
      findMany: async (args: { where?: Where; orderBy?: unknown }) => {
        const matched = turns.filter(
          (one) => args.where === undefined || matchesRow(one, args.where),
        )
        return args.orderBy === undefined ? matched : sortRows(matched, args.orderBy)
      },
    },
    cloudSandbox: {
      findUnique: async (args: { where: { threadId: string } }) =>
        cloudSandboxes.find((one) => one.threadId === args.where.threadId) ?? null,
      findFirst: async (args: { where: Where }) =>
        cloudSandboxes.find((one) => matchesRow(one, args.where)) ?? null,
      findMany: async (args: { where?: Where; orderBy?: unknown }) => {
        const matched = cloudSandboxes.filter(
          (one) => args.where === undefined || matchesRow(one, args.where),
        )
        return args.orderBy === undefined ? matched : sortRows(matched, args.orderBy)
      },
      upsert: async (args: {
        where: { threadId: string }
        create: FakeCloudSandboxRow
        update: Where
      }) => {
        const existing = cloudSandboxes.find((one) => one.threadId === args.where.threadId)
        if (existing === undefined) {
          cloudSandboxes.push(args.create)
          return args.create
        }
        applyUpdate(existing as unknown as Record<string, unknown>, args.update)
        return existing
      },
      update: async (args: { where: { threadId: string }; data: Where }) => {
        const row = cloudSandboxes.find((one) => one.threadId === args.where.threadId)
        if (row === undefined) throw new Error('record not found')
        applyUpdate(row as unknown as Record<string, unknown>, args.data)
        return row
      },
      delete: async (args: { where: { threadId: string } }) => {
        const index = cloudSandboxes.findIndex((one) => one.threadId === args.where.threadId)
        if (index === -1) throw new Error('record not found')
        const [removed] = cloudSandboxes.splice(index, 1)
        return removed
      },
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db),
  }

  return {
    db,
    threads,
    events,
    turns,
    cloudSandboxes,
    reset: () => {
      threads.length = 0
      events.length = 0
      turns.length = 0
      cloudSandboxes.length = 0
    },
  }
}

export type FakeSessionDb = ReturnType<typeof createFakeSessionDb>

let current: FakeSessionDb | undefined

export function fakeSessionDb(): FakeSessionDb {
  current ??= createFakeSessionDb()
  return current
}
