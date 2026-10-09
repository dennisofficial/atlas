import { applyUpdate, matchesValue, sortRows, uniqueViolation, type Where } from './fake-db-support'
import {
  createFakePrEventTable,
  createFakePrStateTable,
  createFakeRepoHookTable,
  createFakeSubscriptionTable,
} from './fake-github-realtime-db'
import type {
  FakePrEventRow,
  FakePrStateRow,
  FakeRepoHookRow,
  FakeSubscriptionRow,
} from './fake-github-realtime-db'

export type {
  FakePrEventRow,
  FakePrStateRow,
  FakeRepoHookRow,
  FakeSubscriptionRow,
} from './fake-github-realtime-db'

export type FakeCloudSettingRow = {
  id: string
  userId: string
  key: string
  value: string
  createdAt: Date
  updatedAt: Date
}

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

export type FakeCloudSandboxRow = {
  id: string
  threadId: string
  userId: string
  sandboxId: string
  name: string
  region: string
  state: string
  lastActivityAt: string
  driveName?: string | null
  serveUrl?: string | null
  serveVersion?: string | null
  tokenHash?: string
  sealedToken?: string | null
}

const matchesWhere = <Row>(row: Row, where: Where | undefined): boolean => {
  if (where === undefined) return true
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR' && Array.isArray(condition)) {
      return (condition as Where[]).some((clause) => matchesWhere(row, clause))
    }
    if (key === 'AND' && Array.isArray(condition)) {
      return (condition as Where[]).every((clause) => matchesWhere(row, clause))
    }
    if (key === 'sandbox' && typeof condition === 'object' && condition !== null) {
      const threadId = (row as unknown as Where).threadId
      if (typeof threadId !== 'string') return false
      const sandbox = cloudSandboxes.find((candidate) => candidate.threadId === threadId)
      return sandbox !== undefined && matchesWhere(sandbox, condition as Where)
    }
    return matchesValue((row as unknown as Where)[key], condition)
  })
}

let cloudSandboxes: FakeCloudSandboxRow[] = []

export function seedCloudSandbox(row: FakeCloudSandboxRow): void {
  cloudSandboxes = [...cloudSandboxes.filter((held) => held.threadId !== row.threadId), row]
}

function createFakeGithubDb() {
  let events: FakeWebhookEventRow[] = []
  let pullRequests: FakePullRequestRow[] = []
  let subscriptions: FakeSubscriptionRow[] = []
  let repoHooks: FakeRepoHookRow[] = []
  let prStates: FakePrStateRow[] = []
  let prEvents: FakePrEventRow[] = []
  let cloudSettings: FakeCloudSettingRow[] = []
  cloudSandboxes = []

  const subscriptionTable = createFakeSubscriptionTable({
    matchesWhere,
    rows: () => subscriptions,
    setRows: (rows) => {
      subscriptions = rows
    },
  })
  const prEventTable = createFakePrEventTable({
    matchesWhere,
    rows: () => prEvents,
    setRows: (rows) => {
      prEvents = rows
    },
  })

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
    githubSubscription: subscriptionTable,
    githubRepoHook: createFakeRepoHookTable({
      matchesWhere,
      rows: () => repoHooks,
      setRows: (rows) => {
        repoHooks = rows
      },
    }),
    githubPrState: createFakePrStateTable({
      matchesWhere,
      rows: () => prStates,
      setRows: (rows) => {
        prStates = rows
      },
    }),
    githubPrEvent: prEventTable,
    cloudSetting: {
      findMany: async (args: { where?: Where } = {}) =>
        cloudSettings.filter((row) => matchesWhere(row, args.where)),
    },
    cloudSandbox: {
      findMany: async (args: { where?: Where } = {}) =>
        cloudSandboxes.filter((row) => matchesWhere(row, args.where)),
      update: async (args: { where: { threadId: string }; data: Where }) => {
        const held = cloudSandboxes.find((row) => row.threadId === args.where.threadId)
        if (held === undefined) throw new Error('fake cloudSandbox.update: no row')
        applyUpdate(held as unknown as Record<string, unknown>, args.data)
        return held
      },
    },
  }

  const subscriptionFindMany = subscriptionTable.findMany
  subscriptionTable.findMany = async (query: { where?: Where; include?: Where } = {}) => {
    const rows = await subscriptionFindMany(query)
    if (query.include?.sandbox !== true) return rows
    return rows.map((row) => ({
      ...row,
      sandbox:
        typeof row.threadId === 'string'
          ? (cloudSandboxes.find((candidate) => candidate.threadId === row.threadId) ?? null)
          : null,
    }))
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
    get prEvents() {
      return prEvents
    },
    get cloudSettings() {
      return cloudSettings
    },
    get cloudSandboxes() {
      return cloudSandboxes
    },
    reset() {
      events = []
      pullRequests = []
      subscriptions = []
      repoHooks = []
      prStates = []
      prEvents = []
      cloudSettings = []
      cloudSandboxes = []
      subscriptionTable.resetSequence()
      prEventTable.resetSequence()
    },
  }
}

export type FakeGithubDb = ReturnType<typeof createFakeGithubDb>

let current: FakeGithubDb | null = null

export function fakeGithubDb(): FakeGithubDb {
  current ??= createFakeGithubDb()
  return current
}
