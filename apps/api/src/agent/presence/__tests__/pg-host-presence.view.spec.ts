import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import pg from 'pg'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { createPgHostPresence } from '../pg-host-presence'

const testDb = useTestDatabase()

const HOST_TABLE = 'public."Host"'

describe('the v2 V2Host view over the public Host table', () => {
  const admin = new pg.Client(testDb().url)

  beforeAll(async () => {
    await admin.connect()
  })

  afterAll(async () => {
    await admin.end()
  })

  it('hides the sequence behind the view while the table keeps its own', async () => {
    const { rows } = await admin.query<{ view: string | null; table: string | null }>(
      `SELECT pg_get_serial_sequence('"v2"."V2Host"', 'id') AS "view",
              pg_get_serial_sequence('public."Host"', 'id') AS "table"`,
    )
    expect(rows).toEqual([{ view: null, table: 'public."V2Host_id_seq"' }])
  })

  it('accepts the statement the old image runs and returns the id it wrote', async () => {
    const inserted = await admin.query<{ id: number }>(
      'INSERT INTO "public"."Host" (label, "startedAt") VALUES ($1, now()) RETURNING id',
      ['view-host'],
    )
    const id = inserted.rows[0]?.id
    const { rows } = await admin.query<{ label: string }>(
      `SELECT label FROM ${HOST_TABLE} WHERE id = $1`,
      [id],
    )
    expect(rows).toEqual([{ label: 'view-host' }])
  })

  it('registers and closes through the public table', async () => {
    const presence = createPgHostPresence({ url: testDb().url, label: 'view-host' })
    const hostId = await presence.register()
    const { rows } = await admin.query<{ label: string }>(
      `SELECT label FROM ${HOST_TABLE} WHERE id = $1`,
      [hostId],
    )
    expect(rows).toEqual([{ label: 'view-host' }])

    await presence.close()
    const gone = await admin.query(`SELECT 1 FROM ${HOST_TABLE} WHERE id = $1`, [hostId])
    expect(gone.rows).toEqual([])
  })
})
