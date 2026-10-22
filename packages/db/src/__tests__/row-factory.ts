import contractJson from '../prisma/schema/contract.json' with { type: 'json' }

type Column = { codecId: string; nullable: boolean; default?: unknown; many?: unknown }
type ForeignKey = { source: { columns: string[] }; target: { tableName: string; columns: string[] } }
type Table = { columns: Record<string, Column>; foreignKeys: ForeignKey[] }

export const TIMESTAMP_CODEC = 'pg/timestamptz-date@1'

const tables: Record<string, Table> = contractJson.storage.namespaces.public.entries.table
const models: Record<string, { storage: { table: string } }> = contractJson.domain.namespaces.public.models

export function modelOfTable(table: string): string {
  const found = Object.entries(models).find(([, model]) => model.storage.table === table)
  if (found === undefined) throw new Error(`no model stores table ${table}`)
  return found[0]
}

const OVERRIDES: Record<string, Record<string, unknown>> = {
  Project: { ownerUserId: 'User' },
}

function literalFor({ column, name, table }: { column: Column; name: string; table: string }): unknown {
  if (column.codecId === TIMESTAMP_CODEC) return new Date('2026-10-22T02:02:04.222Z')
  if (column.codecId === 'pg/int4@1' || column.codecId === 'pg/int8@1') return 1
  if (column.codecId === 'pg/bool@1') return false
  if (column.codecId === 'pg/jsonb@1') return JSON.stringify({})
  if (column.codecId === 'pg/bytea@1') return Buffer.from('x')
  return `${table}.${name}`
}

function dependenciesOf(table: string): string[] {
  const own = tables[table]
  if (own === undefined) return []
  const required = own.foreignKeys.filter((key) =>
    key.source.columns.some((column) => own.columns[column]?.nullable === false),
  )
  const overridden = Object.values(OVERRIDES[table] ?? {}).filter((value) => typeof value === 'string')
  return [...required.map((key) => key.target.tableName), ...overridden].filter((name) => name !== table)
}

export function tableOrder(): string[] {
  const ordered: string[] = []
  const visit = (table: string) => {
    if (ordered.includes(table)) return
    for (const dependency of dependenciesOf(table)) visit(dependency)
    ordered.push(table)
  }
  for (const table of Object.keys(tables).sort()) visit(table)
  return ordered
}

export function timestampColumns(table: string): string[] {
  const own = tables[table]
  if (own === undefined) return []
  return Object.entries(own.columns)
    .filter(([, column]) => column.codecId === TIMESTAMP_CODEC)
    .map(([name]) => name)
}

export function rowFor({ table, keys }: { table: string; keys: Map<string, Record<string, unknown>> }) {
  const own = tables[table]
  if (own === undefined) throw new Error(`no table ${table}`)
  const row: Record<string, unknown> = {}
  for (const [name, column] of Object.entries(own.columns)) {
    if (column.nullable && column.default === undefined && column.codecId !== TIMESTAMP_CODEC) continue
    row[name] = literalFor({ column, name, table })
  }
  for (const key of own.foreignKeys) {
    const parent = keys.get(key.target.tableName)
    const required = key.source.columns.some((column) => own.columns[column]?.nullable === false)
    if (!required || parent === undefined) continue
    key.source.columns.forEach((column, index) => {
      const targetColumn = key.target.columns[index]
      if (targetColumn !== undefined) row[column] = parent[targetColumn]
    })
  }
  for (const [column, parentTable] of Object.entries(OVERRIDES[table] ?? {})) {
    row[column] = typeof parentTable === 'string' ? keys.get(parentTable)?.id : parentTable
  }
  return row
}
