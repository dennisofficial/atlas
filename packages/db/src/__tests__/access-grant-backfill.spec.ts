import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import pg from 'pg'
import { databaseUrl, laneUrl, quoteIdent } from '../testing/lane'
import { applyMigration, applyMigrations } from '../testing/migrations'

const MIGRATION = '20261125T1742_access_grants'
const DATABASE = `atlas_test_access_grant_backfill_${process.pid}`
const LONG_PATH = `~/${'a'.repeat(120)}`

const admin = () => new pg.Client({ connectionString: laneUrl().toString() })

describe('access grants backfill migration', () => {
  let client: pg.Client

  const insertProject = (args: { id: string; ownerUserId: string }) =>
    client.query(
      `INSERT INTO "Project" (id, name, "ownerUserId", "createdById", "updatedAt")
       VALUES ($1, $1, $2, $2, now())`,
      [args.id, args.ownerUserId],
    )

  const insertUserSecret = (args: { id: string; userId: string; name: string; at: string }) =>
    client.query(
      `INSERT INTO "SecretEntry" (id, name, "sealedValue", "userId", "createdAt", "updatedAt")
       VALUES ($1, $2, 'sealed', $3, $4, $4)`,
      [args.id, args.name, args.userId, args.at],
    )

  const insertProjectSecret = (args: { id: string; projectId: string; name: string; at: string }) =>
    client.query(
      `INSERT INTO "ProjectSecret" (id, "projectId", name, "sealedValue", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'sealed', $4, $4)`,
      [args.id, args.projectId, args.name, args.at],
    )

  const insertProjectMount = (args: { id: string; projectId: string; path: string; at: string }) =>
    client.query(
      `INSERT INTO "ProjectFileMount" (id, "projectId", path, "sealedContents", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'sealed', $4, $4)`,
      [args.id, args.projectId, args.path, args.at],
    )

  beforeAll(async () => {
    const lane = admin()
    await lane.connect()
    await lane.query(`DROP DATABASE IF EXISTS ${quoteIdent(DATABASE)} WITH (FORCE)`)
    await lane.query(`CREATE DATABASE ${quoteIdent(DATABASE)}`)
    await lane.end()
    client = new pg.Client({ connectionString: databaseUrl({ lane: laneUrl(), name: DATABASE }) })
    await client.connect()
    await applyMigrations(client, { stopBefore: MIGRATION })

    await client.query(
      `INSERT INTO "User" (id, name, email, "updatedAt")
       VALUES ('u1', 'u1', 'u1@t.local', now()), ('u2', 'u2', 'u2@t.local', now())`,
    )
    await insertProject({ id: 'p1', ownerUserId: 'u1' })
    await insertProject({ id: 'p2', ownerUserId: 'u2' })

    await insertUserSecret({
      id: 's1',
      userId: 'u1',
      name: 'API_TOKEN',
      at: '2026-01-01T00:00:00Z',
    })
    await insertUserSecret({
      id: 's2',
      userId: 'u2',
      name: 'API_TOKEN',
      at: '2026-01-02T00:00:00Z',
    })

    await insertProjectSecret({
      id: 'ps1',
      projectId: 'p1',
      name: 'SHARED',
      at: '2026-02-01T00:00:00Z',
    })
    await insertProjectMount({
      id: 'pf1',
      projectId: 'p1',
      path: 'SHARED',
      at: '2026-02-02T00:00:00Z',
    })
    await insertProjectMount({
      id: 'pf2',
      projectId: 'p1',
      path: LONG_PATH,
      at: '2026-02-03T00:00:00Z',
    })
    await insertProjectMount({
      id: 'pf3',
      projectId: 'p1',
      path: `${LONG_PATH}b`,
      at: '2026-02-04T00:00:00Z',
    })
    await insertProjectSecret({
      id: 'ps2',
      projectId: 'p2',
      name: 'SHARED',
      at: '2026-02-05T00:00:00Z',
    })

    await applyMigration({ client, directory: MIGRATION })
  })

  afterAll(async () => {
    await client.end()
    const lane = admin()
    await lane.connect()
    await lane.query(`DROP DATABASE IF EXISTS ${quoteIdent(DATABASE)} WITH (FORCE)`)
    await lane.end()
  })

  const grantsOf = async (table: 'UserAccessGrant' | 'ProjectAccessGrant') =>
    (
      await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM "${table}" ORDER BY name`,
      )
    ).rows

  it('gives every existing secret and mount a grant of its own', async () => {
    for (const query of [
      `SELECT "grantId" FROM "SecretEntry"`,
      `SELECT "grantId" FROM "ProjectSecret"`,
      `SELECT "grantId" FROM "ProjectFileMount"`,
    ]) {
      const rows = (await client.query<{ grantId: string | null }>(query)).rows
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.filter((row) => row.grantId === null)).toEqual([])
    }
    expect(await grantsOf('UserAccessGrant')).toHaveLength(2)
    expect(await grantsOf('ProjectAccessGrant')).toHaveLength(5)
  })

  it('names each grant after its row and suffixes a name clash', async () => {
    const personal = await grantsOf('UserAccessGrant')
    expect(personal.map((grant) => grant.name)).toEqual(['API_TOKEN', 'API_TOKEN'])
    expect(personal.map((grant) => grant.id.startsWith('uag_'))).toEqual([true, true])

    const project = await grantsOf('ProjectAccessGrant')
    const longBase = LONG_PATH.slice(0, 80)
    expect(project.map((grant) => grant.name)).toEqual([
      'SHARED',
      'SHARED',
      'SHARED 2',
      `${longBase.slice(0, 78)} 2`,
      longBase,
    ])
    expect(project.map((grant) => grant.id.startsWith('pag_'))).toEqual([
      true,
      true,
      true,
      true,
      true,
    ])
  })

  it('keeps each grant with the owner of its row and leaves the instruction empty', async () => {
    const rows = (
      await client.query<{ name: string; instruction: string; userId: string | null }>(
        `SELECT g.name, g.instruction, g."userId"
         FROM "SecretEntry" s JOIN "UserAccessGrant" g ON g.id = s."grantId" ORDER BY s.id`,
      )
    ).rows
    expect(rows.map((row) => [row.userId, row.instruction])).toEqual([
      ['u1', ''],
      ['u2', ''],
    ])

    const projectRows = (
      await client.query<{ projectId: string; instruction: string }>(
        `SELECT g."projectId", g.instruction
         FROM "ProjectFileMount" m JOIN "ProjectAccessGrant" g ON g.id = m."grantId" ORDER BY m.id`,
      )
    ).rows
    expect(projectRows.map((row) => [row.projectId, row.instruction])).toEqual([
      ['p1', ''],
      ['p1', ''],
      ['p1', ''],
    ])
  })

  it('deletes the members of a grant through the new cascade', async () => {
    const grant = (await grantsOf('ProjectAccessGrant')).find((row) => row.name === 'SHARED 2')
    await client.query(`DELETE FROM "ProjectAccessGrant" WHERE id = $1`, [grant?.id])
    const mounts = await client.query(`SELECT id FROM "ProjectFileMount" WHERE id = 'pf1'`)
    expect(mounts.rowCount).toBe(0)
  })
})
