import { matchesValue, sortRows, uniqueViolation, type Where } from './fake-db-support'

export type FakeWebhookEventRow = {
  id: string
  event: string
  repoFullName: string
  prNumber: number | null
  branch: string | null
  payload: string
  receivedAt: Date
}

export type FakePullRequestRow = {
  repoFullName: string
  number: number
  title: string
  url: string
  state: string
  headBranch: string
  headSha: string
  checksRunning: number
  checksPassed: number
  checksFailed: number
  mergeable: boolean | null
  mergeableState: string | null
  createdAt: Date
  updatedAt: Date
}

export type FakeSubscriptionRow = {
  id: string
  userId: string
  repoFullName: string
  prNumber: number
  pollBacked: boolean
  expiresAt: Date
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
  checksRunning: number
  checksPassed: number
  checksFailed: number
  mergeable: boolean | null
  updatedAt: Date
}

const matchesWhere = <Row>(row: Row, where: Where | undefined): boolean => {
  if (where === undefined) return true
  return Object.entries(where).every(([key, condition]) =>
    matchesValue((row as unknown as Where)[key], condition),
  )
}

function createFakeGithubDb() {
  let events: FakeWebhookEventRow[] = []
  let pullRequests: FakePullRequestRow[] = []
  let subscriptions: FakeSubscriptionRow[] = []
  let repoHooks: FakeRepoHookRow[] = []
  let prStates: FakePrStateRow[] = []
  let subscriptionSequence = 0

  const db = {
    githubWebhookEvent: {
      create: async (args: { data: Omit<FakeWebhookEventRow, 'receivedAt'> & { receivedAt?: Date } }) => {
        if (events.some((row) => row.id === args.data.id)) throw uniqueViolation(['id'])
        const row: FakeWebhookEventRow = { receivedAt: new Date(), ...args.data }
        events.push(row)
        return row
      },
    },
    githubPullRequest: {
      findFirst: async (args: { where?: Where; orderBy?: Where } = {}) => {
        const matched = pullRequests.filter((row) => matchesWhere(row, args.where))
        const ordered = args.orderBy === undefined ? matched : sortRows(matched, args.orderBy)
        return ordered[0] ?? null
      },
      findMany: async (args: { where?: Where } = {}) =>
        pullRequests.filter((row) => matchesWhere(row, args.where)),
      findUnique: async (args: {
        where: { repoFullName_number: { repoFullName: string; number: number } }
      }) => {
        const { repoFullName, number } = args.where.repoFullName_number
        return (
          pullRequests.find(
            (row) => row.repoFullName === repoFullName && row.number === number,
          ) ?? null
        )
      },
      upsert: async (args: {
        where: { repoFullName_number: { repoFullName: string; number: number } }
        create: Omit<FakePullRequestRow, 'createdAt' | 'updatedAt'>
        update: Partial<FakePullRequestRow>
      }) => {
        const { repoFullName, number } = args.where.repoFullName_number
        const held = pullRequests.find(
          (row) => row.repoFullName === repoFullName && row.number === number,
        )
        if (held === undefined) {
          const row: FakePullRequestRow = {
            ...args.create,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
          pullRequests.push(row)
          return row
        }
        Object.assign(held, args.update, { updatedAt: new Date() })
        return held
      },
    },
    githubSubscription: {
      findMany: async (args: { where?: Where } = {}) =>
        subscriptions.filter((row) => matchesWhere(row, args.where)),
      findUnique: async (args: {
        where:
          | { id: string }
          | { userId_repoFullName_prNumber: { userId: string; repoFullName: string; prNumber: number } }
      }) => {
        const where = args.where
        if ('id' in where) return subscriptions.find((row) => row.id === where.id) ?? null
        const key = where.userId_repoFullName_prNumber
        return (
          subscriptions.find(
            (row) =>
              row.userId === key.userId &&
              row.repoFullName === key.repoFullName &&
              row.prNumber === key.prNumber,
          ) ?? null
        )
      },
      upsert: async (args: {
        where: { userId_repoFullName_prNumber: { userId: string; repoFullName: string; prNumber: number } }
        create: Omit<FakeSubscriptionRow, 'id' | 'createdAt'> & { id?: string; createdAt?: Date }
        update: Partial<FakeSubscriptionRow>
      }) => {
        const key = args.where.userId_repoFullName_prNumber
        const held = subscriptions.find(
          (row) =>
            row.userId === key.userId &&
            row.repoFullName === key.repoFullName &&
            row.prNumber === key.prNumber,
        )
        if (held === undefined) {
          subscriptionSequence += 1
          const row: FakeSubscriptionRow = {
            ...args.create,
            pollBacked: args.create.pollBacked,
            id: args.create.id ?? `sub_${subscriptionSequence}`,
            createdAt: args.create.createdAt ?? new Date(),
          }
          subscriptions.push(row)
          return row
        }
        Object.assign(held, args.update)
        return held
      },
      update: async (args: { where: { id: string }; data: Partial<FakeSubscriptionRow> }) => {
        const held = subscriptions.find((row) => row.id === args.where.id)
        if (held === undefined) throw new Error(`no GithubSubscription with id ${args.where.id}`)
        Object.assign(held, args.data)
        return held
      },
      updateMany: async (args: { where?: Where; data: Partial<FakeSubscriptionRow> }) => {
        const matched = subscriptions.filter((row) => matchesWhere(row, args.where))
        for (const row of matched) Object.assign(row, args.data)
        return { count: matched.length }
      },
      deleteMany: async (args: { where?: Where }) => {
        const held = subscriptions.filter((row) => matchesWhere(row, args.where))
        subscriptions = subscriptions.filter((row) => !matchesWhere(row, args.where))
        return { count: held.length }
      },
    },
    githubRepoHook: {
      findUnique: async (args: { where: { repoFullName: string } }) =>
        repoHooks.find((row) => row.repoFullName === args.where.repoFullName) ?? null,
      findMany: async (args: { where?: Where } = {}) =>
        repoHooks.filter((row) => matchesWhere(row, args.where)),
      create: async (args: {
        data: Omit<FakeRepoHookRow, 'createdAt' | 'idleSince' | 'sweepLeaseUntil'> & {
          idleSince?: Date | null
          sweepLeaseUntil?: Date | null
        }
      }) => {
        if (repoHooks.some((row) => row.repoFullName === args.data.repoFullName)) {
          throw uniqueViolation(['repoFullName'])
        }
        const row: FakeRepoHookRow = {
          idleSince: null,
          sweepLeaseUntil: null,
          ...args.data,
          createdAt: new Date(),
        }
        repoHooks.push(row)
        return row
      },
      update: async (args: {
        where: { repoFullName: string }
        data: Partial<FakeRepoHookRow>
      }) => {
        const held = repoHooks.find((row) => row.repoFullName === args.where.repoFullName)
        if (held === undefined) throw new Error(`no GithubRepoHook for ${args.where.repoFullName}`)
        Object.assign(held, args.data)
        return held
      },
      updateMany: async (args: { where?: Where; data: Partial<FakeRepoHookRow> }) => {
        const matched = repoHooks.filter((row) => matchesWhere(row, args.where))
        for (const row of matched) Object.assign(row, args.data)
        return { count: matched.length }
      },
      deleteMany: async (args: { where?: Where }) => {
        const held = repoHooks.filter((row) => matchesWhere(row, args.where))
        repoHooks = repoHooks.filter((row) => !matchesWhere(row, args.where))
        return { count: held.length }
      },
    },
    githubPrState: {
      findUnique: async (args: {
        where: { repoFullName_prNumber: { repoFullName: string; prNumber: number } }
      }) => {
        const key = args.where.repoFullName_prNumber
        return (
          prStates.find(
            (row) => row.repoFullName === key.repoFullName && row.prNumber === key.prNumber,
          ) ?? null
        )
      },
      findMany: async (args: { where?: Where } = {}) =>
        prStates.filter((row) => matchesWhere(row, args.where)),
      upsert: async (args: {
        where: { repoFullName_prNumber: { repoFullName: string; prNumber: number } }
        create: FakePrStateRow
        update: Partial<FakePrStateRow>
      }) => {
        const key = args.where.repoFullName_prNumber
        const held = prStates.find(
          (row) => row.repoFullName === key.repoFullName && row.prNumber === key.prNumber,
        )
        if (held === undefined) {
          prStates.push(args.create)
          return args.create
        }
        Object.assign(held, args.update)
        return held
      },
    },
  }

  return {
    db,
    get events() {
      return events
    },
    get pullRequests() {
      return pullRequests
    },
    get subscriptions() {
      return subscriptions
    },
    get repoHooks() {
      return repoHooks
    },
    get prStates() {
      return prStates
    },
    reset() {
      events = []
      pullRequests = []
      subscriptions = []
      repoHooks = []
      prStates = []
      subscriptionSequence = 0
    },
  }
}

export type FakeGithubDb = ReturnType<typeof createFakeGithubDb>

let current: FakeGithubDb | null = null

export function fakeGithubDb(): FakeGithubDb {
  current ??= createFakeGithubDb()
  return current
}
