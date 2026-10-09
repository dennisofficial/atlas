import { uniqueViolation, type Where } from './fake-db-support'

export type FakeSubscriptionRow = {
  id: string
  userId: string
  repoFullName: string
  prNumber: number | null
  branch: string
  pollBacked: boolean
  expiresAt: Date
  threadId: string | null
  sandboxId: string | null
  createdAt: Date
}

export type FakeRepoHookRow = {
  repoFullName: string
  hookId: bigint
  secret: string
  createdBy: string
  status: string
  idleSince: Date | null
  sweepLeaseUntil: Date | null
  createdAt: Date
}

export type FakePrStateRow = {
  repoFullName: string
  prNumber: number
  title: string
  url: string
  state: string
  headBranch: string
  headSha: string
  headRepoFullName: string | null
  checksRunning: number
  checksPassed: number
  checksFailed: number
  mergeable: boolean | null
  updatedAt: Date
}

export type FakePrEventRow = {
  id: string
  userId: string
  repoFullName: string
  prNumber: number
  kind: string
  payload: unknown
  deliveredAt: Date | null
  createdAt: Date
}

export type MatchesWhere = <Row>(row: Row, where: Where | undefined) => boolean

export function createFakeSubscriptionTable(args: {
  matchesWhere: MatchesWhere
  rows: () => FakeSubscriptionRow[]
  setRows: (rows: FakeSubscriptionRow[]) => void
}) {
  let sequence = 0
  const table = {
    findMany: async (query: { where?: Where } = {}) =>
      args.rows().filter((row) => args.matchesWhere(row, query.where)),
    findUnique: async (query: {
      where:
        | { id: string }
        | { userId_repoFullName_branch: { userId: string; repoFullName: string; branch: string } }
    }) => {
      const where = query.where
      if ('id' in where) return args.rows().find((row) => row.id === where.id) ?? null
      const key = where.userId_repoFullName_branch
      return (
        args
          .rows()
          .find(
            (row) =>
              row.userId === key.userId &&
              row.repoFullName === key.repoFullName &&
              row.branch === key.branch,
          ) ?? null
      )
    },
    upsert: async (query: {
      where: { userId_repoFullName_branch: { userId: string; repoFullName: string; branch: string } }
      create: Omit<FakeSubscriptionRow, 'id' | 'createdAt'> & { id?: string; createdAt?: Date }
      update: Partial<FakeSubscriptionRow>
    }) => {
      const key = query.where.userId_repoFullName_branch
      const held = args
        .rows()
        .find(
          (row) =>
            row.userId === key.userId &&
            row.repoFullName === key.repoFullName &&
            row.branch === key.branch,
        )
      if (held === undefined) {
        sequence += 1
        const row: FakeSubscriptionRow = {
          ...query.create,
          id: query.create.id ?? `sub_${sequence}`,
          createdAt: query.create.createdAt ?? new Date(),
        }
        args.setRows([...args.rows(), row])
        return row
      }
      Object.assign(held, query.update)
      return held
    },
    update: async (query: { where: { id: string }; data: Partial<FakeSubscriptionRow> }) => {
      const held = args.rows().find((row) => row.id === query.where.id)
      if (held === undefined) throw new Error(`no GithubSubscription with id ${query.where.id}`)
      Object.assign(held, query.data)
      return held
    },
    updateMany: async (query: { where?: Where; data: Partial<FakeSubscriptionRow> }) => {
      const matched = args.rows().filter((row) => args.matchesWhere(row, query.where))
      for (const row of matched) Object.assign(row, query.data)
      return { count: matched.length }
    },
    deleteMany: async (query: { where?: Where }) => {
      const held = args.rows().filter((row) => args.matchesWhere(row, query.where))
      args.setRows(args.rows().filter((row) => !args.matchesWhere(row, query.where)))
      return { count: held.length }
    },
    resetSequence: () => {
      sequence = 0
    },
  }
  return table
}

export function createFakeRepoHookTable(args: {
  matchesWhere: MatchesWhere
  rows: () => FakeRepoHookRow[]
  setRows: (rows: FakeRepoHookRow[]) => void
}) {
  return {
    findUnique: async (query: { where: { repoFullName: string } }) =>
      args.rows().find((row) => row.repoFullName === query.where.repoFullName) ?? null,
    findMany: async (query: { where?: Where } = {}) =>
      args.rows().filter((row) => args.matchesWhere(row, query.where)),
    create: async (query: {
      data: Omit<FakeRepoHookRow, 'createdAt' | 'idleSince' | 'sweepLeaseUntil'> & {
        idleSince?: Date | null
        sweepLeaseUntil?: Date | null
      }
    }) => {
      if (args.rows().some((row) => row.repoFullName === query.data.repoFullName)) {
        throw uniqueViolation(['repoFullName'])
      }
      const row: FakeRepoHookRow = {
        idleSince: null,
        sweepLeaseUntil: null,
        ...query.data,
        createdAt: new Date(),
      }
      args.setRows([...args.rows(), row])
      return row
    },
    update: async (query: { where: { repoFullName: string }; data: Partial<FakeRepoHookRow> }) => {
      const held = args.rows().find((row) => row.repoFullName === query.where.repoFullName)
      if (held === undefined) throw new Error(`no GithubRepoHook for ${query.where.repoFullName}`)
      Object.assign(held, query.data)
      return held
    },
    updateMany: async (query: { where?: Where; data: Partial<FakeRepoHookRow> }) => {
      const matched = args.rows().filter((row) => args.matchesWhere(row, query.where))
      for (const row of matched) Object.assign(row, query.data)
      return { count: matched.length }
    },
    deleteMany: async (query: { where?: Where }) => {
      const held = args.rows().filter((row) => args.matchesWhere(row, query.where))
      args.setRows(args.rows().filter((row) => !args.matchesWhere(row, query.where)))
      return { count: held.length }
    },
  }
}

export function createFakePrEventTable(args: {
  matchesWhere: MatchesWhere
  rows: () => FakePrEventRow[]
  setRows: (rows: FakePrEventRow[]) => void
}) {
  let sequence = 0
  const table = {
    create: async (query: {
      data: Omit<FakePrEventRow, 'id' | 'deliveredAt' | 'createdAt'> & {
        id?: string
        deliveredAt?: Date | null
        createdAt?: Date
      }
    }) => {
      sequence += 1
      const row: FakePrEventRow = {
        id: query.data.id ?? `evt_${sequence}`,
        deliveredAt: query.data.deliveredAt ?? null,
        createdAt: query.data.createdAt ?? new Date(),
        ...query.data,
      }
      args.setRows([...args.rows(), row])
      return row
    },
    findMany: async (query: { where?: Where; orderBy?: Where } = {}) => {
      const matched = args.rows().filter((row) => args.matchesWhere(row, query.where))
      const ordered =
        query.orderBy === undefined
          ? matched
          : [...matched].sort((left, right) => {
              const [field, direction] = Object.entries(query.orderBy ?? {})[0] ?? ['createdAt', 'asc']
              const a = (left as unknown as Where)[field] as Date
              const b = (right as unknown as Where)[field] as Date
              const compare = a.getTime() - b.getTime()
              return direction === 'desc' ? -compare : compare
            })
      return ordered
    },
    updateMany: async (query: { where?: Where; data: Partial<FakePrEventRow> }) => {
      const matched = args.rows().filter((row) => args.matchesWhere(row, query.where))
      for (const row of matched) Object.assign(row, query.data)
      return { count: matched.length }
    },
    resetSequence: () => {
      sequence = 0
    },
  }
  return table
}

export function createFakePrStateTable(args: {
  matchesWhere: MatchesWhere
  rows: () => FakePrStateRow[]
  setRows: (rows: FakePrStateRow[]) => void
}) {
  return {
    findUnique: async (query: {
      where: { repoFullName_prNumber: { repoFullName: string; prNumber: number } }
    }) => {
      const key = query.where.repoFullName_prNumber
      return (
        args
          .rows()
          .find((row) => row.repoFullName === key.repoFullName && row.prNumber === key.prNumber) ??
        null
      )
    },
    findMany: async (query: { where?: Where } = {}) =>
      args.rows().filter((row) => args.matchesWhere(row, query.where)),
    upsert: async (query: {
      where: { repoFullName_prNumber: { repoFullName: string; prNumber: number } }
      create: FakePrStateRow
      update: Partial<FakePrStateRow>
    }) => {
      const key = query.where.repoFullName_prNumber
      const held = args
        .rows()
        .find((row) => row.repoFullName === key.repoFullName && row.prNumber === key.prNumber)
      if (held === undefined) {
        args.setRows([...args.rows(), query.create])
        return query.create
      }
      Object.assign(held, query.update)
      return held
    },
  }
}
