import type { PrismaClient } from '../../../generated/prisma/client'

export interface FakeProjectRow {
  id: string
  userId: string
  name: string
  repo: string | null
  baseBranch: string | null
  additionalRepos: unknown
  createdAt: Date
  updatedAt: Date
}

type Where = { id?: string; userId?: string }

export const projectRows: FakeProjectRow[] = []

let sequence = 0

const matches = (row: FakeProjectRow, where: Where): boolean =>
  (where.id === undefined || row.id === where.id) &&
  (where.userId === undefined || row.userId === where.userId)

export function resetProjectRows(): void {
  projectRows.length = 0
  sequence = 0
}

const project = {
  findMany: async (args: { where: Where }) =>
    projectRows
      .filter((row) => matches(row, args.where))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
  findFirst: async (args: { where: Where }) =>
    projectRows.find((row) => matches(row, args.where)) ?? null,
  create: async (args: { data: Omit<FakeProjectRow, 'id' | 'createdAt' | 'updatedAt'> }) => {
    sequence += 1
    const now = new Date(Date.UTC(2026, 9, 20, 12, 0, sequence))
    const row = { ...args.data, id: `proj_${sequence}`, createdAt: now, updatedAt: now }
    projectRows.push(row)
    return row
  },
  update: async (args: { where: { id: string }; data: Partial<FakeProjectRow> }) => {
    const row = projectRows.find((candidate) => candidate.id === args.where.id)
    if (row === undefined) throw new Error('record to update not found')
    sequence += 1
    Object.assign(row, args.data, { updatedAt: new Date(Date.UTC(2026, 9, 20, 12, 0, sequence)) })
    return row
  },
  deleteMany: async (args: { where: Where }) => {
    const kept = projectRows.filter((row) => !matches(row, args.where))
    const count = projectRows.length - kept.length
    projectRows.splice(0, projectRows.length, ...kept)
    return { count }
  },
}

export const fakeProjectDb = (): PrismaClient => ({ project }) as unknown as PrismaClient
