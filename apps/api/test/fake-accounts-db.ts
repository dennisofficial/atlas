import { uniqueViolation } from './fake-db-support'

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

export function createFakeAccountTables() {
  const agentAccounts: FakeAgentAccountRow[] = []
  const activeAccounts: FakeActiveAccountRow[] = []

  const db = {
    agentAccount: {
      create: async (args: { data: FakeAgentAccountRow }) => {
        if (agentAccounts.some((one) => one.id === args.data.id)) throw uniqueViolation(['id'])
        agentAccounts.push(args.data)
        return args.data
      },
      findUnique: async (args: { where: { id: string } }) =>
        agentAccounts.find((one) => one.id === args.where.id) ?? null,
      delete: async (args: { where: { id: string } }) => {
        const index = agentAccounts.findIndex((one) => one.id === args.where.id)
        if (index === -1) throw new Error('record not found')
        agentAccounts.splice(index, 1)
      },
    },
    activeAccount: {
      findUnique: async (args: {
        where: { userId_provider: { userId: string; provider: string } }
      }) =>
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
      update: async (args: {
        where: { userId_provider: { userId: string; provider: string } }
        data: { accountId: string }
      }) => {
        const row = activeAccounts.find(
          (one) =>
            one.userId === args.where.userId_provider.userId &&
            one.provider === args.where.userId_provider.provider,
        )
        if (row === undefined) throw new Error('record not found')
        row.accountId = args.data.accountId
        return row
      },
    },
  }

  return {
    db,
    agentAccounts,
    activeAccounts,
    reset: () => {
      agentAccounts.length = 0
      activeAccounts.length = 0
    },
  }
}
