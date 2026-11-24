import { describe, expect, it } from 'bun:test'
import { useTestDatabase } from '../testing'

type IndexRow = { indexname: string }

describe('V2DiagramRepair indexes', () => {
  const testDb = useTestDatabase()

  it('keeps only the primary key index, whose leading column is sessionId', async () => {
    const { pool } = testDb()
    const result = await pool.query<IndexRow>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'v2' AND tablename = 'V2DiagramRepair' ORDER BY indexname`,
    )
    expect(result.rows.map((row) => row.indexname)).toEqual(['V2DiagramRepair_pkey'])
  })
})
