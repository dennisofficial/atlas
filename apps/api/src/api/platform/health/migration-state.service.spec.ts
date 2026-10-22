import { contractStorageHash, sharedPool } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { EMigrationState, MigrationStateService } from './migration-state.service'

describe('MigrationStateService against Postgres', () => {
  useTestDatabase()

  const sign = async (hash: string) => {
    await sharedPool().query(
      `INSERT INTO prisma_contract.marker (space, core_hash, profile_hash) VALUES ('app', $1, '') ON CONFLICT (space) DO UPDATE SET core_hash = $1`,
      [hash],
    )
  }

  it('is behind when the database carries no marker', async () => {
    await sharedPool().query('CREATE SCHEMA IF NOT EXISTS prisma_contract')
    await sharedPool().query('DROP TABLE IF EXISTS prisma_contract.marker')
    const report = await new MigrationStateService().report()
    expect(report.state).toBe(EMigrationState.Behind)
  })

  it('is level when the marker matches the emitted contract', async () => {
    await createMarkerTable()
    await sign(contractStorageHash)
    expect((await new MigrationStateService().report()).state).toBe(EMigrationState.Level)
  })

  it('is behind when the marker is an older contract in the graph', async () => {
    await createMarkerTable()
    await sign('61df0a50bbb3c9d17ab1dec28c5abe4475eb2769cb4d4a43a1620b17085f4221')
    expect((await new MigrationStateService().report()).state).toBe(EMigrationState.Behind)
  })

  it('stays level when the marker is a contract newer than this build', async () => {
    await createMarkerTable()
    await sign('f'.repeat(64))
    expect((await new MigrationStateService().report()).state).toBe(EMigrationState.Level)
  })
})

async function createMarkerTable(): Promise<void> {
  await sharedPool().query('CREATE SCHEMA IF NOT EXISTS prisma_contract')
  await sharedPool().query(
    'CREATE TABLE IF NOT EXISTS prisma_contract.marker (space text PRIMARY KEY, core_hash text NOT NULL, profile_hash text NOT NULL)',
  )
}
