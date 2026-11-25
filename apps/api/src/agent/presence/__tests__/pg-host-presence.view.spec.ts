import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import pg from 'pg'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { createPgHostPresence } from '../pg-host-presence'

const testDb = useTestDatabase()

const BASE_TABLE = '"v2"."V2Host_base"'

describe('pg host presence through an auto-updatable view', () => {
  const admin = new pg.Client(testDb().url)

  beforeAll(async () => {
    await admin.connect()
    await admin.query(`ALTER TABLE "v2"."V2Host" RENAME TO "V2Host_base"`)
    await admin.query(`CREATE VIEW "v2"."V2Host" AS SELECT * FROM ${BASE_TABLE}`)
  })

  afterAll(async () => {
    await admin.query('DROP VIEW "v2"."V2Host"')
    await admin.query(`ALTER TABLE ${BASE_TABLE} RENAME TO "V2Host"`)
    await admin.end()
  })

  it('has no sequence behind the view, so the insert leaves the id to the column default', async () => {
    const { rows } = await admin.query<{ sequence: string | null }>(
      `SELECT pg_get_serial_sequence('"v2"."V2Host"', 'id') AS sequence`,
    )
    expect(rows).toEqual([{ sequence: null }])
  })

  it('registers and closes through the view', async () => {
    const presence = createPgHostPresence({ url: testDb().url, label: 'view-host' })
    const hostId = await presence.register()
    const { rows } = await admin.query<{ label: string }>(
      `SELECT label FROM ${BASE_TABLE} WHERE id = $1`,
      [hostId],
    )
    expect(rows).toEqual([{ label: 'view-host' }])

    await presence.close()
    const gone = await admin.query(`SELECT 1 FROM ${BASE_TABLE} WHERE id = $1`, [hostId])
    expect(gone.rows).toEqual([])
  })
})
