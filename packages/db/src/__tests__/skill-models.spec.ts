import { describe, expect, it } from 'bun:test'
import { useTestDatabase } from '../testing'

type PgError = { code?: string; constraint?: string }

function pgError(error: unknown): PgError {
  if (typeof error === 'object' && error !== null) return error as PgError
  throw error
}

async function insertUser(
  pool: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  id: string,
) {
  await pool.query(
    `INSERT INTO "User" (id, name, email, "updatedAt") VALUES ($1, $1, $1 || '@t.local', now())`,
    [id],
  )
}

async function insertProject(
  pool: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  id: string,
  ownerId: string,
) {
  await pool.query(
    `INSERT INTO "Project" (id, name, "ownerUserId", "updatedAt") VALUES ($1, $1, $2, now())`,
    [id, ownerId],
  )
}

async function insertSkill(
  pool: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  {
    id,
    userId = null,
    projectId = null,
    name,
  }: { id: string; userId?: string | null; projectId?: string | null; name: string },
) {
  await pool.query(
    `INSERT INTO "Skill" (id, "userId", "projectId", name, "updatedAt") VALUES ($1, $2, $3, $4, now())`,
    [id, userId, projectId, name],
  )
}

async function insertSkillFile(
  pool: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  { id, skillId, path }: { id: string; skillId: string; path: string },
) {
  await pool.query(
    `INSERT INTO "SkillFile" (id, "skillId", path, revision, "contentHash", content, "isText", size, "updatedAt")
     VALUES ($1, $2, $3, 1, 'h', $4, true, 1, now())`,
    [id, skillId, path, Buffer.from('x')],
  )
}

describe('Skill and SkillFile models', () => {
  const testDb = useTestDatabase()

  it('stores a user-owned skill with files and reads it back through the ORM', async () => {
    const { pool, db } = testDb()
    await insertUser(pool, 'u1')
    await insertSkill(pool, { id: 's1', userId: 'u1', name: 'review' })
    await insertSkillFile(pool, { id: 'f1', skillId: 's1', path: 'SKILL.md' })

    const skill = await db.orm.public.Skill.first()
    expect(skill).toMatchObject({
      id: 's1',
      userId: 'u1',
      projectId: null,
      name: 'review',
      description: '',
    })
    const file = await db.orm.public.SkillFile.first()
    expect(file).toMatchObject({
      skillId: 's1',
      path: 'SKILL.md',
      revision: 1,
      isText: true,
      size: 1,
    })
  })

  it('enforces the composite uniques per owner while NULL owners never collide', async () => {
    const { pool } = testDb()
    await insertUser(pool, 'u1')
    await insertUser(pool, 'u2')
    await insertProject(pool, 'p1', 'u1')
    await insertSkill(pool, { id: 's1', userId: 'u1', name: 'review' })

    const duplicate = await insertSkill(pool, { id: 's2', userId: 'u1', name: 'review' }).then(
      () => null,
      (error: unknown) => pgError(error),
    )
    expect(duplicate?.code).toBe('23505')
    expect(duplicate?.constraint).toBe('Skill_userId_name_key')

    await insertSkill(pool, { id: 's3', userId: 'u2', name: 'review' })
    await insertSkill(pool, { id: 's4', projectId: 'p1', name: 'review' })
    const projectDuplicate = await insertSkill(pool, {
      id: 's5',
      projectId: 'p1',
      name: 'review',
    }).then(
      () => null,
      (error: unknown) => pgError(error),
    )
    expect(projectDuplicate?.code).toBe('23505')
    expect(projectDuplicate?.constraint).toBe('Skill_projectId_name_key')
  })

  it('enforces the composite unique on SkillFile (skillId, path)', async () => {
    const { pool } = testDb()
    await insertUser(pool, 'u1')
    await insertSkill(pool, { id: 's1', userId: 'u1', name: 'review' })
    await insertSkillFile(pool, { id: 'f1', skillId: 's1', path: 'SKILL.md' })

    const duplicate = await insertSkillFile(pool, {
      id: 'f2',
      skillId: 's1',
      path: 'SKILL.md',
    }).then(
      () => null,
      (error: unknown) => pgError(error),
    )
    expect(duplicate?.code).toBe('23505')
    expect(duplicate?.constraint).toBe('SkillFile_skillId_path_key')
  })

  it('rejects a skill with both owners null and with both owners set', async () => {
    const { pool } = testDb()
    await insertUser(pool, 'u1')
    await insertProject(pool, 'p1', 'u1')

    const neither = await insertSkill(pool, { id: 's1', name: 'review' }).then(
      () => null,
      (error: unknown) => pgError(error),
    )
    expect(neither?.code).toBe('23514')
    expect(neither?.constraint).toMatch(/^Skill_owner_check_/)

    const both = await insertSkill(pool, {
      id: 's2',
      userId: 'u1',
      projectId: 'p1',
      name: 'review',
    }).then(
      () => null,
      (error: unknown) => pgError(error),
    )
    expect(both?.code).toBe('23514')
    expect(both?.constraint).toMatch(/^Skill_owner_check_/)
  })

  it('cascades from User, from Project, and from Skill to its files', async () => {
    const { pool } = testDb()
    await insertUser(pool, 'u1')
    await insertUser(pool, 'u2')
    await insertProject(pool, 'p1', 'u2')
    await insertSkill(pool, { id: 's1', userId: 'u1', name: 'a' })
    await insertSkill(pool, { id: 's2', projectId: 'p1', name: 'b' })
    await insertSkillFile(pool, { id: 'f1', skillId: 's1', path: 'SKILL.md' })
    await insertSkillFile(pool, { id: 'f2', skillId: 's2', path: 'SKILL.md' })

    const counts = async () => {
      const skills = (await pool.query('SELECT count(*)::int AS n FROM "Skill"')) as {
        rows: { n: number }[]
      }
      const files = (await pool.query('SELECT count(*)::int AS n FROM "SkillFile"')) as {
        rows: { n: number }[]
      }
      return { skills: skills.rows[0]?.n, files: files.rows[0]?.n }
    }

    await pool.query(`DELETE FROM "User" WHERE id = 'u1'`)
    expect(await counts()).toEqual({ skills: 1, files: 1 })

    await pool.query(`DELETE FROM "SkillFile" WHERE id = 'f2'`)
    await insertSkillFile(pool, { id: 'f3', skillId: 's2', path: 'SKILL.md' })
    await pool.query(`DELETE FROM "Project" WHERE id = 'p1'`)
    expect(await counts()).toEqual({ skills: 0, files: 0 })

    await insertUser(pool, 'u3')
    await insertSkill(pool, { id: 's3', userId: 'u3', name: 'c' })
    await insertSkillFile(pool, { id: 'f4', skillId: 's3', path: 'SKILL.md' })
    await pool.query(`DELETE FROM "Skill" WHERE id = 's3'`)
    expect(await counts()).toEqual({ skills: 0, files: 0 })
  })
})
