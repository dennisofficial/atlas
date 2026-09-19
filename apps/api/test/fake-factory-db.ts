import { applyUpdate, matchesValue, project, sortRows, type Where } from './fake-db-support'

export type FakeWorkItemRow = {
  id: string
  repo: string
  sourceKind: string
  status: string
  orchestratorThreadId: string | null
  driveName: string | null
  revisionCycles: number
  lastActivityAt: string
  createdAt: string
  updatedAt: string
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
  workItemId: string
  surface: string
  deliveryId: string
  author: string | null
  authorAssociation: string | null
  kind: string
  payload: string
  receivedAt: string
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

  const db = {
    factoryWorkItem: {
      create: async (args: { data: Where }) => {
        const row: FakeWorkItemRow = {
          orchestratorThreadId: null,
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
    },
    factorySurfaceAlias: {
      create: async (args: { data: FakeAliasRow }) => {
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
      create: async (args: { data: FakeTranscriptEventRow }) => {
        transcriptEvents.push(args.data)
        return args.data
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
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db),
  }

  return {
    db,
    workItems,
    aliases,
    transcriptEvents,
    reset: () => {
      workItems.length = 0
      aliases.length = 0
      transcriptEvents.length = 0
    },
  }
}

export type FakeFactoryDb = ReturnType<typeof createFakeFactoryDb>

let current: FakeFactoryDb | undefined

export function fakeFactoryDb(): FakeFactoryDb {
  current ??= createFakeFactoryDb()
  return current
}
