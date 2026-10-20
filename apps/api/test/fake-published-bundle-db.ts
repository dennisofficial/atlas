import { uniqueViolation } from './fake-db-support'

export type FakePublishedBundleRow = {
  id: string
  userId: string
  version: number
  pathname: string
  blobUrl: string
  sha256: string
  sizeBytes: number
  manifest: unknown
  createdAt: Date
}

type CreateData = Omit<FakePublishedBundleRow, 'id' | 'createdAt'>

export function createFakePublishedBundleDb() {
  const bundles: FakePublishedBundleRow[] = []
  let sequence = 0
  let collideNextVersion = false

  const publishedBundle = {
    findUnique: async (args: { where: { pathname: string } }) => {
      const row = bundles.find((one) => one.pathname === args.where.pathname)
      return row === undefined ? null : { ...row }
    },
    findFirst: async (args: { where: { userId: string } }) => {
      const owned = bundles.filter((one) => one.userId === args.where.userId)
      const latest = owned.sort((a, b) => b.version - a.version)[0]
      return latest === undefined ? null : { ...latest }
    },
    aggregate: async (args: { where: { userId: string } }) => {
      const versions = bundles.filter((one) => one.userId === args.where.userId).map((one) => one.version)
      return { _max: { version: versions.length === 0 ? null : Math.max(...versions) } }
    },
    create: async (args: { data: CreateData }) => {
      if (bundles.some((one) => one.pathname === args.data.pathname)) throw uniqueViolation(['pathname'])
      if (collideNextVersion) {
        collideNextVersion = false
        throw uniqueViolation(['userId', 'version'])
      }
      if (bundles.some((one) => one.userId === args.data.userId && one.version === args.data.version)) {
        throw uniqueViolation(['userId', 'version'])
      }
      sequence += 1
      const row = { id: `bundle_${sequence}`, ...args.data, createdAt: new Date() }
      bundles.push(row)
      return { ...row }
    },
  }

  const client = {
    publishedBundle,
    $transaction: async <T>(run: (tx: { publishedBundle: typeof publishedBundle }) => Promise<T>) =>
      run({ publishedBundle }),
  }

  return {
    db: client,
    bundles,
    collideNextVersion: () => {
      collideNextVersion = true
    },
    reset: () => {
      bundles.length = 0
      sequence = 0
      collideNextVersion = false
    },
  }
}

export type FakePublishedBundleDb = ReturnType<typeof createFakePublishedBundleDb>

export const sharedPublishedBundleDb = createFakePublishedBundleDb()
