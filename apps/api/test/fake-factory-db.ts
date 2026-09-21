import { Prisma } from '../src/generated/prisma/client'
import { applyUpdate, matchesValue, project, sortRows, type Where } from './fake-db-support'

export const uniqueViolation = (target: readonly string[]): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError(
    `Unique constraint failed on the fields: (${target.map((field) => `\`${field}\``).join(',')})`,
    {
      code: 'P2002',
      clientVersion: Prisma.prismaVersion.client,
      meta: {
        driverAdapterError: {
          name: 'DriverAdapterError',
          cause: { kind: 'UniqueConstraintViolation', constraint: { fields: [...target] } },
        },
      },
    },
  )

export type FakeWorkItemRow = {
  id: string
  repo: string
  sourceKind: string
  status: string
  orchestratorThreadId: string | null
  orchestratorDeliveredEventId: string | null
  driveName: string | null
  revisionCycles: number
  lastActivityAt: string
  createdAt: string
  updatedAt: string
}

export type FakeOrchestratorThreadRow = {
  id: string
  head: number
}

export type FakeOrchestratorEventRow = {
  id: string
  threadId: string
  seq: number
  type: string
  body: string
}

export type FakeAliasRow = {
  id: string
  workItemId: string
  surface: string
  externalId: string
  kind: string
  createdAt: string
}

export type FakeTranscriptEventRow = {
  id: string
  seq: number
  workItemId: string
  surface: string
  deliveryId: string
  author: string | null
  authorAssociation: string | null
  kind: string
  payload: string
  receivedAt: string
}

export type FakeUserRow = {
  id: string
  name: string
  email: string
}

export type FakeAgentAccountRow = {
  id: string
  provider: string
  kind: string
  origin: string
  label: string
  status: string
  email: string | null
  subscription: string | null
  importedFrom: string | null
  sealedSecret: string
  userId: string
}

export type FakeActiveAccountRow = {
  userId: string
  provider: string
  accountId: string
}

type FakeRow = FakeWorkItemRow | FakeAliasRow | FakeTranscriptEventRow

const matchesRow = (row: FakeRow, where: Where): boolean =>
  Object.entries(where).every(([key, condition]) =>
    matchesValue((row as unknown as Where)[key], condition),
  )

export function createFakeFactoryDb() {
  const workItems: FakeWorkItemRow[] = []
  const aliases: FakeAliasRow[] = []
  const transcriptEvents: FakeTranscriptEventRow[] = []
  const users: FakeUserRow[] = []
  const agentAccounts: FakeAgentAccountRow[] = []
  const activeAccounts: FakeActiveAccountRow[] = []
  const threads: FakeOrchestratorThreadRow[] = []
  const events: FakeOrchestratorEventRow[] = []

  const db = {
    factoryWorkItem: {
      findFirst: async (args: { where: Where; select?: Record<string, boolean> }) => {
        const found = workItems.find((one) => matchesRow(one, args.where)) ?? null
        return found === null ? null : project(found, args.select)
      },
      create: async (args: { data: Where }) => {
        if (workItems.some((one) => one.id === args.data.id)) throw uniqueViolation(['id'])
        const row: FakeWorkItemRow = {
          orchestratorThreadId: null,
          orchestratorDeliveredEventId: null,
          driveName: null,
          revisionCycles: 0,
          ...(args.data as Partial<FakeWorkItemRow>),
        } as FakeWorkItemRow
        workItems.push(row)
        return row
      },
      findUnique: async (args: { where: { id: string } }) =>
        workItems.find((one) => one.id === args.where.id) ?? null,
      findUniqueOrThrow: async (args: { where: { id: string } }) => {
        const row = workItems.find((one) => one.id === args.where.id)
        if (row === undefined) throw new Error('record not found')
        return row
      },
      findMany: async (args: { where?: Where; orderBy?: unknown }) => {
        const matched = workItems.filter(
          (one) => args.where === undefined || matchesRow(one, args.where),
        )
        return args.orderBy === undefined ? matched : sortRows(matched, args.orderBy)
      },
      update: async (args: { where: { id: string }; data: Where }) => {
        const row = workItems.find((one) => one.id === args.where.id)
        if (row === undefined) throw new Error('record not found')
        applyUpdate(row as unknown as Record<string, unknown>, args.data)
        return row
      },
      updateMany: async (args: { where: Where; data: Where }) => {
        const matched = workItems.filter((one) => matchesRow(one, args.where))
        for (const row of matched) applyUpdate(row as unknown as Record<string, unknown>, args.data)
        return { count: matched.length }
      },
    },
    factorySurfaceAlias: {
      create: async (args: { data: FakeAliasRow }) => {
        if (aliases.some((one) => one.id === args.data.id)) throw uniqueViolation(['id'])
        const clash = aliases.some(
          (one) => one.surface === args.data.surface && one.externalId === args.data.externalId,
        )
        if (clash) throw uniqueViolation(['surface', 'externalId'])
        aliases.push(args.data)
        return args.data
      },
      findFirst: async (args: { where: Where; select?: Record<string, boolean> }) => {
        const found = aliases.find((one) => matchesRow(one, args.where)) ?? null
        return found === null ? null : project(found, args.select)
      },
      findMany: async (args: { where?: Where }) =>
        aliases.filter((one) => args.where === undefined || matchesRow(one, args.where)),
    },
    factoryTranscriptEvent: {
      create: async (args: { data: Omit<FakeTranscriptEventRow, 'seq'> & { seq?: number } }) => {
        if (transcriptEvents.some((one) => one.id === args.data.id)) throw uniqueViolation(['id'])
        const clash = transcriptEvents.some(
          (one) => one.surface === args.data.surface && one.deliveryId === args.data.deliveryId,
        )
        if (clash) throw uniqueViolation(['surface', 'deliveryId'])
        const row: FakeTranscriptEventRow = {
          ...args.data,
          seq: args.data.seq ?? transcriptEvents.length + 1,
        }
        transcriptEvents.push(row)
        return row
      },
      findFirst: async (args: { where: Where; select?: Record<string, boolean> }) => {
        const found = transcriptEvents.find((one) => matchesRow(one, args.where)) ?? null
        return found === null ? null : project(found, args.select)
      },
      findMany: async (args: { where?: Where; orderBy?: unknown }) => {
        const matched = transcriptEvents.filter(
          (one) => args.where === undefined || matchesRow(one, args.where),
        )
        return args.orderBy === undefined ? matched : sortRows(matched, args.orderBy)
      },
      count: async (args: { where?: Where }) =>
        transcriptEvents.filter(
          (one) => args.where === undefined || matchesRow(one, args.where),
        ).length,
    },
    user: {
      upsert: async (args: {
        where: { email: string }
        create: FakeUserRow
        update: Where
      }) => {
        const found = users.find((one) => one.email === args.where.email)
        if (found !== undefined) return found
        users.push(args.create)
        return args.create
      },
    },
    agentAccount: {
      create: async (args: { data: FakeAgentAccountRow }) => {
        if (agentAccounts.some((one) => one.id === args.data.id)) throw uniqueViolation(['id'])
        agentAccounts.push(args.data)
        return args.data
      },
      delete: async (args: { where: { id: string } }) => {
        const index = agentAccounts.findIndex((one) => one.id === args.where.id)
        if (index === -1) throw new Error('record not found')
        agentAccounts.splice(index, 1)
      },
    },
    activeAccount: {
      findUnique: async (args: { where: { userId_provider: { userId: string; provider: string } } }) =>
        activeAccounts.find(
          (one) =>
            one.userId === args.where.userId_provider.userId &&
            one.provider === args.where.userId_provider.provider,
        ) ?? null,
      create: async (args: { data: FakeActiveAccountRow }) => {
        const clash = activeAccounts.some(
          (one) => one.userId === args.data.userId && one.provider === args.data.provider,
        )
        if (clash) throw uniqueViolation(['userId', 'provider'])
        activeAccounts.push(args.data)
        return args.data
      },
    },
    thread: {
      delete: async (args: { where: { id: string } }) => {
        const index = threads.findIndex((one) => one.id === args.where.id)
        if (index === -1) throw new Error('record not found')
        threads.splice(index, 1)
      },
    },
    event: {
      findFirst: async (args: { where: Where; select?: Record<string, boolean> }) => {
        const found = events.find((one) => matchesRow(one as unknown as FakeRow, args.where))
        return found === undefined ? null : project(found, args.select)
      },
      findMany: async (args: { where: Where; select?: Record<string, boolean> }) =>
        events
          .filter((one) => matchesRow(one as unknown as FakeRow, args.where))
          .map((one) => project(one, args.select)),
      create: async (args: { data: FakeOrchestratorEventRow }) => {
        events.push(args.data)
        const thread = threads.find((one) => one.id === args.data.threadId)
        if (thread !== undefined) thread.head += 1
        return args.data
      },
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      const snapshot = {
        workItems: workItems.map((one) => ({ ...one })),
        aliases: aliases.map((one) => ({ ...one })),
        transcriptEvents: transcriptEvents.map((one) => ({ ...one })),
        users: users.map((one) => ({ ...one })),
      }
      try {
        return await callback(db)
      } catch (error) {
        workItems.splice(0, workItems.length, ...snapshot.workItems)
        aliases.splice(0, aliases.length, ...snapshot.aliases)
        transcriptEvents.splice(0, transcriptEvents.length, ...snapshot.transcriptEvents)
        users.splice(0, users.length, ...snapshot.users)
        throw error
      }
    },
  }

  return {
    db,
    workItems,
    aliases,
    transcriptEvents,
    users,
    agentAccounts,
    activeAccounts,
    threads,
    events,
    reset: () => {
      workItems.length = 0
      aliases.length = 0
      transcriptEvents.length = 0
      users.length = 0
      agentAccounts.length = 0
      activeAccounts.length = 0
      threads.length = 0
      events.length = 0
    },
  }
}

export type FakeFactoryDb = ReturnType<typeof createFakeFactoryDb>

let current: FakeFactoryDb | undefined

export function fakeFactoryDb(): FakeFactoryDb {
  current ??= createFakeFactoryDb()
  return current
}
