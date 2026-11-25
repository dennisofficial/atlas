import { describe, expect, it } from 'bun:test'
import { useTestDatabase } from '../testing'

type Pool = { query: (sql: string, params?: unknown[]) => Promise<unknown> }

async function insertUser(pool: Pool, id: string) {
  await pool.query(
    `INSERT INTO "User" (id, name, email, "updatedAt") VALUES ($1, $1, $1 || '@t.local', now())`,
    [id],
  )
}

async function insertGroup(pool: Pool, args: { id: string; userId: string; name: string }) {
  await pool.query(
    `INSERT INTO "ProjectGroup" (id, "userId", name, "updatedAt") VALUES ($1, $2, $3, now())`,
    [args.id, args.userId, args.name],
  )
}

async function insertProject(pool: Pool, args: { id: string; ownerId: string; groupId: string }) {
  await pool.query(
    `INSERT INTO "Project" (id, name, "ownerUserId", "groupId", "updatedAt") VALUES ($1, $1, $2, $3, now())`,
    [args.id, args.ownerId, args.groupId],
  )
}

describe('ProjectGroup and its scoped rows', () => {
  const testDb = useTestDatabase()

  it('deletes its own rows and ungroups its projects', async () => {
    const { pool, db } = testDb()
    await insertUser(pool, 'u1')
    await insertGroup(pool, { id: 'g1', userId: 'u1', name: 'Comp AI' })
    await insertProject(pool, { id: 'p1', ownerId: 'u1', groupId: 'g1' })

    await pool.query(
      `INSERT INTO "GroupAccessGrant" (id, "groupId", name, "updatedAt") VALUES ('a1', 'g1', 'deploy', now())`,
    )
    await pool.query(
      `INSERT INTO "GroupSecret" (id, "groupId", name, "sealedValue", "grantId", "updatedAt")
       VALUES ('s1', 'g1', 'API_KEY', 'sealed', 'a1', now())`,
    )
    await pool.query(
      `INSERT INTO "GroupFileMount" (id, "groupId", path, "sealedContents", "grantId", "updatedAt")
       VALUES ('f1', 'g1', '~/notes.md', 'sealed', 'a1', now())`,
    )
    await pool.query(
      `INSERT INTO "GroupSetting" (id, "groupId", key, value, "updatedAt")
       VALUES ('st1', 'g1', 'model.id', 'opus', now())`,
    )
    await pool.query(
      `INSERT INTO "Skill" (id, "groupId", name, "updatedAt") VALUES ('sk1', 'g1', 'review', now())`,
    )
    await pool.query(
      `INSERT INTO "McpServer" (id, name, source, "sealedSpec", "groupId", "updatedAt")
       VALUES ('m1', 'linear', 'cloud', 'sealed', 'g1', now())`,
    )

    await db.orm.public.ProjectGroup.where({ id: 'g1' }).delete()

    const project = await db.orm.public.Project.first({ id: 'p1' })
    expect(project?.groupId).toBeNull()
    expect(await db.orm.public.GroupAccessGrant.all()).toEqual([])
    expect(await db.orm.public.GroupSecret.all()).toEqual([])
    expect(await db.orm.public.GroupFileMount.all()).toEqual([])
    expect(await db.orm.public.GroupSetting.all()).toEqual([])
    expect(await db.orm.public.Skill.all()).toEqual([])
    expect(await db.orm.public.McpServer.all()).toEqual([])
  })

  it('keeps group names unique per user and leaves a skill scoped to exactly one owner', async () => {
    const { pool, db } = testDb()
    await insertUser(pool, 'u1')
    await insertUser(pool, 'u2')
    await insertGroup(pool, { id: 'g1', userId: 'u1', name: 'Comp AI' })
    await insertGroup(pool, { id: 'g2', userId: 'u2', name: 'Comp AI' })

    const duplicate = await pool
      .query(`INSERT INTO "ProjectGroup" (id, "userId", name, "updatedAt")
              VALUES ('g3', 'u1', 'Comp AI', now())`)
      .then(() => null)
      .catch((error: unknown) => error as { constraint?: string })
    expect(duplicate?.constraint).toBe('ProjectGroup_userId_name_key')

    const twoScopes = await pool
      .query(`INSERT INTO "Skill" (id, "userId", "groupId", name, "updatedAt")
              VALUES ('sk1', 'u1', 'g1', 'review', now())`)
      .then(() => null)
      .catch((error: unknown) => error as { constraint?: string })
    expect(twoScopes?.constraint).toMatch(/^Skill_owner_check_/)

    await pool.query(
      `INSERT INTO "Skill" (id, "groupId", name, "updatedAt") VALUES ('sk2', 'g1', 'review', now())`,
    )
    const saved = await db.orm.public.Skill.first({ id: 'sk2' })
    expect(saved).toMatchObject({ userId: null, projectId: null, groupId: 'g1' })
  })
})
