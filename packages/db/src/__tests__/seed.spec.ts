import { describe, expect, it } from 'bun:test'
import { assertLocalTarget } from '../seed/cli'
import { SEED_IDS, seed } from '../seed/seed'
import { useTestDatabase } from '../testing'

describe('seed', () => {
  const testDb = useTestDatabase()

  it('is idempotent and writes one personal project', async () => {
    const { db } = testDb()
    await seed(db)
    await seed(db)

    const projects = await db.orm.public.Project.select('id', 'ownerUserId').all()
    expect(projects).toEqual([{ id: SEED_IDS.personalProject, ownerUserId: SEED_IDS.user }])
  })

  it('refuses any host other than localhost', () => {
    expect(() => assertLocalTarget('postgresql://u:p@db.example.com:5432/atlas')).toThrow(
      'refusing db.example.com',
    )
    expect(assertLocalTarget('postgresql://u:p@localhost:5433/atlas')).toContain('localhost')
  })
})
