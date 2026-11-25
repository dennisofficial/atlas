import { describe, expect, it } from 'bun:test'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import { skillFrontmattersOf, skillTextOf } from '../skill-body'
import { seedGroup, seedOwner, seedSkill } from './config-reader.fixture'

const testDb = useTestDatabase()
const OWNER = { userId: 'user-1', projectId: 'proj-1', groupId: null }

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

    expect(await skillTextOf({ db, owner: OWNER, scope: 'user', name: 'alpha' })).toMatchObject({
      text: 'body',
      revision: 1,
    })
    expect(await skillTextOf({ db, owner: OWNER, scope: 'project', name: 'beta' })).toMatchObject({
      text: 'body',
      revision: 1,
    })
  })

  it('reads a group skill by group scope and lists it beside the user and project rows', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedGroup(db)
    await seedSkill({ db, name: 'gamma', scope: 'group' })

    const owner = { userId: 'user-1', projectId: 'proj-1', groupId: 'grp-1' }
    expect(await skillTextOf({ db, owner, scope: 'group', name: 'gamma' })).toMatchObject({
      text: 'body',
      revision: 1,
    })
    const texts = await skillFrontmattersOf({ db, owner })
    expect(texts.map((text) => [text.scope, text.name])).toEqual([['group', 'gamma']])
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
    ).toMatchObject({ text: 'one', revision: 1 })
    expect(
      await skillTextOf({ db, owner: OWNER, scope: 'user', name: 'alpha', path: 'skill.md' }),
    ).toMatchObject({ text: 'body', revision: 1 })
  })

  it('reads the SKILL.md text of every user and project skill in one pass', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedSkill({ db, name: 'alpha', scope: 'user' })
    await seedSkill({ db, name: 'beta', scope: 'project' })

    const texts = await skillFrontmattersOf({ db, owner: OWNER })
    expect(texts.map((one) => `${one.scope}:${one.name}`).sort()).toEqual([
      'project:beta',
      'user:alpha',
    ])
    expect(texts.every((one) => one.text === 'body')).toBe(true)
  })

  it('reads the exact SKILL.md entry of every skill and skips a skill that has none', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedSkill({ db, name: 'lower', scope: 'user', entryPath: 'skill.md' })
    const bare = await db.orm.public.Skill.create({
      name: 'bare',
      description: 'bare description',
      userId: 'user-1',
    })
    await seedFile({ db, skillId: bare.id, path: 'references/one.md', text: 'one' })
    await seedSkill({ db, name: 'gamma', scope: 'user' })
    await seedSkill({ db, name: 'delta', scope: 'project', entryPath: 'Skill.Md' })

    expect(await skillTextOf({ db, owner: OWNER, scope: 'user', name: 'lower' })).toMatchObject({
      text: 'body',
      revision: 1,
      hash: 'h',
    })
    const texts = await skillFrontmattersOf({ db, owner: OWNER })
    expect(texts.map((one) => `${one.scope}:${one.name}`)).toEqual(['user:gamma'])
    expect(texts.every((one) => one.text === 'body')).toBe(true)
  })

  it('matches a custom path literally, so _ and % select only that file', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedSkill({ db, name: 'alpha', scope: 'user' })
    const skill = await db.orm.public.Skill.first({ userId: 'user-1', name: 'alpha' })
    if (skill === null || skill === undefined) throw new Error('the fixture seeded no skill')
    await seedFile({ db, skillId: skill.id, path: 'refs/one_two.md', text: 'underscore' })
    await seedFile({ db, skillId: skill.id, path: 'refs/oneXtwo.md', text: 'star' })
    await seedFile({ db, skillId: skill.id, path: 'refs/50%.md', text: 'percent' })
    await seedFile({ db, skillId: skill.id, path: 'refs/50X.md', text: 'other' })

    expect(
      await skillTextOf({
        db,
        owner: OWNER,
        scope: 'user',
        name: 'alpha',
        path: 'refs/one_two.md',
      }),
    ).toMatchObject({ text: 'underscore' })
    expect(
      await skillTextOf({
        db,
        owner: OWNER,
        scope: 'user',
        name: 'alpha',
        path: 'refs/50%.md',
      }),
    ).toMatchObject({ text: 'percent' })
    expect(
      await skillTextOf({
        db,
        owner: OWNER,
        scope: 'user',
        name: 'alpha',
        path: 'refs/oneXtwo.md',
      }),
    ).toMatchObject({ text: 'star' })
    expect(
      await skillTextOf({ db, owner: OWNER, scope: 'user', name: 'alpha', path: 'refs/50.md' }),
    ).toBeNull()
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
