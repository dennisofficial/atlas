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

export type FailableOperation = 'create' | 'updateMany' | 'deleteMany'

type KeyWhere = { userId: string; githubKeyId?: bigint }
type KeyData = Partial<Omit<FakeSigningKeyRow, 'id' | 'userId' | 'createdAt'>>

const matches = (where: KeyWhere) => (row: FakeSigningKeyRow) =>
  row.userId === where.userId && (where.githubKeyId === undefined || row.githubKeyId === where.githubKeyId)

export function createFakeSigningKeyDb() {
  const keys: FakeSigningKeyRow[] = []
  const connections: FakeConnectionRow[] = []
  let sequence = 0
  let failNextCreateWithRace = false
  const armed = new Set<FailableOperation>()

  const throwIfArmed = (operation: FailableOperation) => {
    if (!armed.delete(operation)) return
    throw new Error(`injected ${operation} failure`)
  }

  const sshSigningKey = {
    findUnique: async (args: { where: { userId: string } }) => {
      const row = keys.find((one) => one.userId === args.where.userId)
      return row === undefined ? null : { ...row }
    },
    create: async (args: { data: Omit<FakeSigningKeyRow, 'id' | 'createdAt' | 'updatedAt'> }) => {
      throwIfArmed('create')
      if (failNextCreateWithRace || keys.some((row) => row.userId === args.data.userId)) {
        failNextCreateWithRace = false
        throw uniqueViolation(['userId'])
      }
      sequence += 1
      const row = { id: `key_${sequence}`, ...args.data, createdAt: new Date(), updatedAt: new Date() }
      keys.push(row)
      return row
    },
    updateMany: async (args: { where: KeyWhere; data: KeyData }) => {
      throwIfArmed('updateMany')
      const matched = keys.filter(matches(args.where))
      for (const row of matched) Object.assign(row, args.data, { updatedAt: new Date() })
      return { count: matched.length }
    },
    deleteMany: async (args: { where: KeyWhere }) => {
      throwIfArmed('deleteMany')
      const doomed = keys.filter(matches(args.where))
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
    failNext: (operation: FailableOperation) => {
      armed.add(operation)
    },
    reset: () => {
      keys.length = 0
      connections.length = 0
      sequence = 0
      failNextCreateWithRace = false
      armed.clear()
    },
  }
}

export type FakeSigningKeyDb = ReturnType<typeof createFakeSigningKeyDb>

export const sharedSigningKeyDb = createFakeSigningKeyDb()
