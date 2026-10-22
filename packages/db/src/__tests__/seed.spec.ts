import { describe, expect, it } from 'bun:test'
import { assertLocalTarget } from '../seed/cli'
import { SEED_IDS, seed } from '../seed/seed'
import { useTestDatabase } from '../testing'

describe('seed', () => {
  const testDb = useTestDatabase()

  it('is idempotent and writes one of each owner kind', async () => {
    const { db } = testDb()
    await seed(db)
    await seed(db)

    const projects = await db.orm.public.Project.select('id', 'ownerUserId', 'organizationId').all()
    expect(projects).toHaveLength(2)
    expect(projects).toContainEqual({
      id: SEED_IDS.personalProject,
      ownerUserId: SEED_IDS.user,
      organizationId: null,
    })
    expect(projects).toContainEqual({
      id: SEED_IDS.workspaceProject,
      ownerUserId: null,
      organizationId: SEED_IDS.organization,
    })
    expect(await db.orm.public.Member.all()).toHaveLength(1)
  })

  it('refuses any host other than localhost', () => {
    expect(() => assertLocalTarget('postgresql://u:p@db.example.com:5432/atlas')).toThrow(
      'refusing db.example.com',
    )
    expect(assertLocalTarget('postgresql://u:p@localhost:5433/atlas')).toContain('localhost')
  })
})
