export interface FakeMemoryRow {
  id: string
  userId: string
  scope: string
  project: string
  name: string
  description: string
  type: string
  body: string
  revision: number
  createdAt: Date
  updatedAt: Date
}

interface UniqueKey {
  userId: string
  scope: string
  project: string
  name: string
}

type ByUnique = { userId_scope_project_name: UniqueKey }
type Fields = Pick<FakeMemoryRow, 'description' | 'type' | 'body'>

const sameKey = ({ row, key }: { row: FakeMemoryRow; key: UniqueKey }): boolean =>
  row.userId === key.userId &&
  row.scope === key.scope &&
  row.project === key.project &&
  row.name === key.name

export function createFakeMemoryDb() {
  const rows: FakeMemoryRow[] = []
  let sequence = 0
  let clock = Date.parse('2026-10-20T12:00:00.000Z')
  let beforeUpdateMany: (() => void) | null = null

  const tick = (): Date => new Date((clock += 1000))

  const memory = {
    findMany: async (args: { where: { userId: string; project?: { in: string[] } } }) =>
      rows
        .filter(
          (row) =>
            row.userId === args.where.userId &&
            (args.where.project === undefined || args.where.project.in.includes(row.project)),
        )
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
    findUnique: async (args: { where: ByUnique }) => {
      const key = args.where.userId_scope_project_name
      return rows.find((row) => sameKey({ row, key })) ?? null
    },
    upsert: async (args: {
      where: ByUnique
      create: UniqueKey & Fields
      update: Fields & { revision: { increment: number } }
    }) => {
      const existing = rows.find((row) =>
        sameKey({ row, key: args.where.userId_scope_project_name }),
      )
      if (existing) {
        existing.description = args.update.description
        existing.type = args.update.type
        existing.body = args.update.body
        existing.revision += args.update.revision.increment
        existing.updatedAt = tick()
        return existing
      }
      const created = {
        ...args.create,
        id: `mem_${++sequence}`,
        revision: 1,
        createdAt: tick(),
        updatedAt: tick(),
      }
      rows.push(created)
      return created
    },
    updateMany: async (args: {
      where: { id: string; userId: string; revision: number }
      data: { body: string; revision: { increment: number } }
    }) => {
      beforeUpdateMany?.()
      beforeUpdateMany = null
      const row = rows.find(
        (r) =>
          r.id === args.where.id &&
          r.userId === args.where.userId &&
          r.revision === args.where.revision,
      )
      if (!row) return { count: 0 }
      row.body = args.data.body
      row.revision += args.data.revision.increment
      row.updatedAt = tick()
      return { count: 1 }
    },
    deleteMany: async (args: { where: UniqueKey }) => {
      const kept = rows.filter((row) => !sameKey({ row, key: args.where }))
      const count = rows.length - kept.length
      rows.splice(0, rows.length, ...kept)
      return { count }
    },
  }

  const db = {
    memory,
    $transaction: async <T>(run: (tx: { memory: typeof memory }) => Promise<T>): Promise<T> =>
      run({ memory }),
  }

  return {
    db,
    rows,
    reset: () => {
      rows.length = 0
      sequence = 0
      beforeUpdateMany = null
    },
    interleaveBeforeUpdateMany: (run: () => void) => {
      beforeUpdateMany = run
    },
  }
}

export const sharedMemoryDb = createFakeMemoryDb()
