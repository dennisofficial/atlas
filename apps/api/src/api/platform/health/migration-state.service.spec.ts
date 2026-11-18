import { contractStorageHash, sharedPool } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { EMigrationState, MigrationStateService } from './migration-state.service'

const OLDER_CONTRACT = '61df0a50bbb3c9d17ab1dec28c5abe4475eb2769cb4d4a43a1620b17085f4221'
const NEWER_CONTRACT = 'f'.repeat(64)

describe('MigrationStateService against Postgres', () => {
  useTestDatabase()

  it('is level when the marker matches the emitted contract', async () => {
    expect((await new MigrationStateService().report()).state).toBe(EMigrationState.Level)
  })

  it('is behind when the marker is an older contract in the graph', async () => {
    await withMarkerHash(OLDER_CONTRACT, async () => {
      expect((await new MigrationStateService().report()).state).toBe(EMigrationState.Behind)
    })
  })

  it('stays level when the marker is a contract newer than this build', async () => {
    await withMarkerHash(NEWER_CONTRACT, async () => {
      expect((await new MigrationStateService().report()).state).toBe(EMigrationState.Level)
    })
  })

  it('is behind when the database carries no marker', async () => {
    await sharedPool().query('ALTER TABLE prisma_contract.marker RENAME TO marker_absent')
    try {
      expect((await new MigrationStateService().report()).state).toBe(EMigrationState.Behind)
    } finally {
      await sharedPool().query('ALTER TABLE prisma_contract.marker_absent RENAME TO marker')
    }
  })
})

async function withMarkerHash(hash: string, work: () => Promise<void>): Promise<void> {
  const pool = sharedPool()
  try {
    await pool.query("UPDATE prisma_contract.marker SET core_hash = $1 WHERE space = 'app'", [hash])
    await work()
  } finally {
    await pool.query("UPDATE prisma_contract.marker SET core_hash = $1 WHERE space = 'app'", [
      contractStorageHash,
    ])
  }
}
