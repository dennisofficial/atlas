import { uniqueViolation } from './fake-db-support'

export type FakeSigningKeyRow = {
  id: string
  userId: string
  publicKey: string
  sealedPrivateKey: string
  githubKeyId: bigint
  userName: string
  userEmail: string
  createdAt: Date
  updatedAt: Date
}

export type FakeConnectionRow = {
  userId: string
  login: string
  scopes: string
  sealedToken: string
}

export function createFakeSigningKeyDb() {
  const keys: FakeSigningKeyRow[] = []
  const connections: FakeConnectionRow[] = []
  let sequence = 0
  let failNextCreateWithRace = false

  const sshSigningKey = {
    findUnique: async (args: { where: { userId: string } }) =>
      keys.find((row) => row.userId === args.where.userId) ?? null,
    create: async (args: { data: Omit<FakeSigningKeyRow, 'id' | 'createdAt' | 'updatedAt'> }) => {
      if (failNextCreateWithRace || keys.some((row) => row.userId === args.data.userId)) {
        failNextCreateWithRace = false
        throw uniqueViolation(['userId'])
      }
      sequence += 1
      const row = { id: `key_${sequence}`, ...args.data, createdAt: new Date(), updatedAt: new Date() }
      keys.push(row)
      return row
    },
    update: async (args: {
      where: { userId: string }
      data: Partial<Omit<FakeSigningKeyRow, 'id' | 'userId' | 'createdAt'>>
    }) => {
      const row = keys.find((one) => one.userId === args.where.userId)
      if (row === undefined) throw new Error('record to update not found')
      Object.assign(row, args.data, { updatedAt: new Date() })
      return row
    },
    deleteMany: async (args: { where: { userId: string } }) => {
      const doomed = keys.filter((row) => row.userId === args.where.userId)
      for (const row of doomed) keys.splice(keys.indexOf(row), 1)
      return { count: doomed.length }
    },
  }

  const githubConnection = {
    findUnique: async (args: { where: { userId: string } }) =>
      connections.find((row) => row.userId === args.where.userId) ?? null,
  }

  return {
    db: { sshSigningKey, githubConnection },
    keys,
    connections,
    raceNextCreate: () => {
      failNextCreateWithRace = true
    },
    reset: () => {
      keys.length = 0
      connections.length = 0
      sequence = 0
      failNextCreateWithRace = false
    },
  }
}

export type FakeSigningKeyDb = ReturnType<typeof createFakeSigningKeyDb>

export const sharedSigningKeyDb = createFakeSigningKeyDb()
