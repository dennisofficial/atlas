import type { PrismaClient } from '../../generated/prisma/client'

type Row = Record<string, unknown> & { id: string }

const matchesWhere = (row: Row, where: Record<string, unknown>): boolean =>
  Object.entries(where).every(([field, expected]) => {
    if (typeof expected === 'object' && expected !== null && 'in' in expected) {
      return (expected as { in: unknown[] }).in.includes(row[field])
    }
    return row[field] === expected
  })

const rowOf = (fields: Record<string, unknown>): Row => ({
  ...fields,
  id: typeof fields.id === 'string' ? fields.id : 'row',
})

const tableOf = (args: { defaults?: Record<string, unknown> } = {}) => {
  const rows: Row[] = []
  const keyOf = (where: Record<string, unknown>): Record<string, unknown> => {
    const compound = Object.values(where).find((value) => typeof value === 'object')
    return (compound as Record<string, unknown> | undefined) ?? where
  }
  return {
    rows,
    findMany: async (query: { where?: Record<string, unknown> } = {}) =>
      rows
        .filter((row) => matchesWhere(row, query.where ?? {}))
        .sort((a, b) => String(a.name ?? a.key).localeCompare(String(b.name ?? b.key))),
    create: async (query: { data: Record<string, unknown> }) => {
      const created = rowOf({
        ...args.defaults,
        ...query.data,
        id: query.data.id ?? `row_${rows.length + 1}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      rows.push(created)
      return created
    },
    findFirst: async (query: { where: Record<string, unknown> }) =>
      rows.find((row) => matchesWhere(row, query.where)) ?? null,
    findUnique: async (query: { where: Record<string, unknown> }) =>
      rows.find((row) => matchesWhere(row, keyOf(query.where))) ?? null,
    updateMany: async (query: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const matched = rows.filter((row) => matchesWhere(row, query.where))
      for (const row of matched) Object.assign(row, query.data, { updatedAt: new Date() })
      return { count: matched.length }
    },
    upsert: async (query: {
      where: Record<string, unknown>
      create: Record<string, unknown>
      update: Record<string, unknown>
    }) => {
      const key = keyOf(query.where)
      const existing = rows.find((row) => matchesWhere(row, key))
      if (existing) return Object.assign(existing, query.update, { updatedAt: new Date() })
      const created = rowOf({
        ...args.defaults,
        ...query.create,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      rows.push(created)
      return created
    },
    update: async (query: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = rows.find((candidate) => matchesWhere(candidate, query.where))
      if (row === undefined) throw new Error('record to update not found')
      return Object.assign(row, query.data, { updatedAt: new Date() })
    },
    deleteMany: async (query: { where: Record<string, unknown> }) => {
      const kept = rows.filter((row) => !matchesWhere(row, query.where))
      const count = rows.length - kept.length
      rows.splice(0, rows.length, ...kept)
      return { count }
    },
  }
}

export function createWebSettingsDb() {
  const tables = {
    secretEntry: tableOf({ defaults: { kind: 'secret' } }),
    cloudSetting: tableOf(),
    mcpServerConfig: tableOf(),
    thread: tableOf({ defaults: { projectId: null } }),
    project: tableOf({
      defaults: {
        description: '',
        shipBehavior: 'open-pr',
        sandboxVcpus: null,
        setupScript: '',
        organizationId: null,
      },
    }),
    projectSecret: tableOf({ defaults: { kind: 'secret' } }),
    projectMcpServer: tableOf(),
    projectSetting: tableOf(),
    member: tableOf(),
    user: tableOf(),
    workspaceSecret: tableOf({
      defaults: { kind: 'secret', updatedById: null },
    }),
    workspaceMcpServer: tableOf(),
    workspaceSetting: tableOf(),
    workspaceVercelCredential: tableOf({ defaults: { updatedById: null } }),
  }
  const db = {
    ...tables,
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  }
  const reset = (): void => {
    for (const table of Object.values(tables)) table.rows.length = 0
  }
  return { db: db as unknown as PrismaClient, tables, reset }
}

export type WebSettingsDb = ReturnType<typeof createWebSettingsDb>

export const sharedWebSettingsDb = createWebSettingsDb()
