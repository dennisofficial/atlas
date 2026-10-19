import { uniqueViolation, type Where } from './fake-db-support'

export type FakePodLeaseRow = {
  id: string
  userId: string
  threadId: string
  tokenHash: string
}

export function createFakePodLeaseDb() {
  const rows: FakePodLeaseRow[] = []
  let sequence = 0

  const heldByAnother = (args: { tokenHash: string; except?: FakePodLeaseRow | undefined }) =>
    rows.some((row) => row.tokenHash === args.tokenHash && row !== args.except)

  const localPodLease = {
    findUnique: async (args: { where: { tokenHash: string }; select?: Record<string, boolean> }) => {
      const row = rows.find((one) => one.tokenHash === args.where.tokenHash) ?? null
      if (row === null || args.select === undefined) return row
      return Object.fromEntries(Object.keys(args.select).map((key) => [key, row[key as keyof FakePodLeaseRow]]))
    },
    upsert: async (args: {
      where: { userId_threadId: { userId: string; threadId: string } }
      create: Omit<FakePodLeaseRow, 'id'>
      update: { tokenHash: string }
    }) => {
      const { userId, threadId } = args.where.userId_threadId
      const existing = rows.find((one) => one.userId === userId && one.threadId === threadId)
      if (existing === undefined) {
        if (heldByAnother({ tokenHash: args.create.tokenHash })) throw uniqueViolation(['tokenHash'])
        sequence += 1
        const row = { id: `lease_${sequence}`, ...args.create }
        rows.push(row)
        return row
      }
      if (heldByAnother({ tokenHash: args.update.tokenHash, except: existing })) {
        throw uniqueViolation(['tokenHash'])
      }
      existing.tokenHash = args.update.tokenHash
      return existing
    },
    deleteMany: async (args: { where: Where }) => {
      const doomed = rows.filter((row) =>
        Object.entries(args.where).every(([key, value]) => row[key as keyof FakePodLeaseRow] === value),
      )
      for (const row of doomed) rows.splice(rows.indexOf(row), 1)
      return { count: doomed.length }
    },
  }

  return { localPodLease, rows }
}

export type FakePodLeaseDb = ReturnType<typeof createFakePodLeaseDb>
