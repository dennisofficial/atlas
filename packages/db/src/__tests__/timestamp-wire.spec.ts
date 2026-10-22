import { describe, expect, it } from 'bun:test'
import { useTestDatabase } from '../testing'
import { modelOfTable, rowFor, tableOrder, timestampColumns } from './row-factory'

const ISO_WIRE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function bigintAsText(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

type FirstReader = { first: () => Promise<unknown> }

function isFirstReader(value: unknown): value is FirstReader {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'first') === 'function'
  )
}

describe('timestamp wire format', () => {
  const testDb = useTestDatabase()

  it('serialises every timestamp column of every model as ISO 8601 with milliseconds and Z', async () => {
    const { pool, db } = testDb()
    const keys = new Map<string, Record<string, unknown>>()
    const checked: string[] = []
    for (const table of tableOrder()) {
      const row = rowFor({ table, keys })
      const columns = Object.keys(row)
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ')
      const names = columns.map((column) => `"${column}"`).join(', ')
      await pool.query(
        `INSERT INTO "public"."${table}" (${names}) VALUES (${placeholders})`,
        Object.values(row),
      )
      keys.set(table, row)

      const stamps = timestampColumns(table)
      if (stamps.length === 0) continue
      const collection: unknown = Reflect.get(db.orm.public, modelOfTable(table))
      if (!isFirstReader(collection)) throw new Error(`no ORM collection for ${table}`)
      const read = await collection.first()
      const wire: Record<string, unknown> = JSON.parse(JSON.stringify(read, bigintAsText))
      for (const column of stamps) {
        expect({ table, column, value: wire[column] }).toEqual({
          table,
          column,
          value: expect.stringMatching(ISO_WIRE),
        })
      }
      checked.push(table)
    }
    expect(checked).toContain('Thread')
    expect(checked).toContain('CloudSandbox')
    expect(checked.length).toBeGreaterThan(30)
  })
})
