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

const matchesWhere = (row: FakePullRequestRow, where: Where | undefined): boolean => {
  if (where === undefined) return true
  return Object.entries(where).every(([key, condition]) =>
    matchesValue((row as unknown as Where)[key], condition),
  )
}

function createFakeGithubDb() {
  let events: FakeWebhookEventRow[] = []
  let pullRequests: FakePullRequestRow[] = []

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
  }

  return {
    db,
    get events() {
      return events
    },
    get pullRequests() {
      return pullRequests
    },
    reset() {
      events = []
      pullRequests = []
    },
  }
}

export type FakeGithubDb = ReturnType<typeof createFakeGithubDb>

let current: FakeGithubDb | null = null

export function fakeGithubDb(): FakeGithubDb {
  current ??= createFakeGithubDb()
  return current
}
