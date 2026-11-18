import { describe, expect, it } from 'bun:test'
import { contractStorageHash } from '../../client'
import { useTestDatabase } from '..'

const MARKER_COLUMNS = [
  'app_tag',
  'canonical_version',
  'contract_json',
  'core_hash',
  'invariants',
  'meta',
  'profile_hash',
  'space',
  'updated_at',
]

describe('the run test database', () => {
  const testDb = useTestDatabase()

  it('copies a marker signed with the emitted contract from the template', async () => {
    const { pool } = testDb()
    const marker = await pool.query<{ core_hash: string }>(
      "SELECT core_hash FROM prisma_contract.marker WHERE space = 'app'",
    )

    expect(marker.rows.map((row) => row.core_hash)).toEqual([contractStorageHash])
  })

  it('copies the marker in the shape the Prisma runtime reads', async () => {
    const { pool } = testDb()
    const columns = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'prisma_contract' AND table_name = 'marker' ORDER BY column_name",
    )

    expect(columns.rows.map((row) => row.column_name)).toEqual(MARKER_COLUMNS)
  })
})
