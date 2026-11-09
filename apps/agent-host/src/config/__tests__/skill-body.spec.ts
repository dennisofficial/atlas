import { describe, expect, it } from 'bun:test'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import { skillTextOf } from '../skill-body'
import { seedOwner, seedSkill } from './config-reader.fixture'

const testDb = useTestDatabase()
const OWNER = { userId: 'user-1', projectId: 'proj-1' }

const seedFile = async (args: {
  db: ReturnType<typeof testDb>['db']
  skillId: string
  path: string
  text: string
}): Promise<void> => {
  await args.db.orm.public.SkillFile.create({
    skillId: args.skillId,
    path: args.path,
    revision: 1,
    contentHash: `h-${args.path}`,
    content: Buffer.from(args.text),
    isText: true,
    size: args.text.length,
  })
}

describe('skillTextOf', () => {
  it('reads the SKILL.md body of a user skill and of a project skill', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedSkill({ db, name: 'alpha', scope: 'user' })
    await seedSkill({ db, name: 'beta', scope: 'project' })

    expect(await skillTextOf({ db, owner: OWNER, scope: 'user', name: 'alpha' })).toBe('body')
    expect(await skillTextOf({ db, owner: OWNER, scope: 'project', name: 'beta' })).toBe('body')
  })

  it('reads one bundled file by path and matches the entry name case-insensitively', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedSkill({ db, name: 'alpha', scope: 'user' })
    const skill = await db.orm.public.Skill.first({ userId: 'user-1', name: 'alpha' })
    if (skill === null || skill === undefined) throw new Error('the fixture seeded no skill')
    await seedFile({ db, skillId: skill.id, path: 'references/one.md', text: 'one' })

    expect(
      await skillTextOf({
        db,
        owner: OWNER,
        scope: 'user',
        name: 'alpha',
        path: 'references/one.md',
      }),
    ).toBe('one')
    expect(
      await skillTextOf({ db, owner: OWNER, scope: 'user', name: 'alpha', path: 'skill.md' }),
    ).toBe('body')
  })

  it('answers null for an unknown skill, an unknown file, and the other scope', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedSkill({ db, name: 'alpha', scope: 'user' })

    expect(await skillTextOf({ db, owner: OWNER, scope: 'user', name: 'missing' })).toBeNull()
    expect(
      await skillTextOf({ db, owner: OWNER, scope: 'user', name: 'alpha', path: 'nope.md' }),
    ).toBeNull()
    expect(await skillTextOf({ db, owner: OWNER, scope: 'project', name: 'alpha' })).toBeNull()
  })
})
