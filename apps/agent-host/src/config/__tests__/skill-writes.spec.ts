import { describe, expect, it } from 'bun:test'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import { skillTextOf } from '../skill-body'
import { skillWriterOf } from '../skill-writes'
import { seedOwner } from './config-reader.fixture'

const testDb = useTestDatabase()
const OWNER = { userId: 'user-1', projectId: 'proj-1' }

const ENTRY = '---\nname: gamma\ndescription: does gamma\n---\n\ngamma body'

const writerFor = (args: {
  db: ReturnType<typeof testDb>['db']
  builtInNames?: readonly string[]
}) => skillWriterOf({ db: args.db, owner: OWNER, builtInNames: args.builtInNames ?? [] })

describe('the cloud skill writer', () => {
  it('creates a skill at revision 1 with the description it was handed', async () => {
    const { db } = testDb()
    await seedOwner(db)

    const written = await writerFor({ db }).write({
      scope: 'user',
      name: 'gamma',
      path: 'SKILL.md',
      body: ENTRY,
      description: 'does gamma',
      baseRevision: 0,
    })
    expect(written).toEqual({ ok: true, revision: 1 })

    const row = await db.orm.public.Skill.first({ userId: 'user-1', name: 'gamma' })
    expect(row?.description).toBe('does gamma')
    expect(await skillTextOf({ db, owner: OWNER, scope: 'user', name: 'gamma' })).toEqual({
      text: ENTRY,
      revision: 1,
      hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })

  it('edits at the revision it was given and refuses the next write based on the old one', async () => {
    const { db } = testDb()
    await seedOwner(db)
    const writer = writerFor({ db })
    await writer.write({
      scope: 'project',
      name: 'gamma',
      path: 'SKILL.md',
      body: ENTRY,
      description: 'does gamma',
      baseRevision: 0,
    })

    const edited = await writer.write({
      scope: 'project',
      name: 'gamma',
      path: 'SKILL.md',
      body: `${ENTRY}\nmore`,
      description: 'does gamma',
      baseRevision: 1,
    })
    expect(edited).toEqual({ ok: true, revision: 2 })

    const stale = await writer.write({
      scope: 'project',
      name: 'gamma',
      path: 'SKILL.md',
      body: ENTRY,
      description: 'does gamma',
      baseRevision: 1,
    })
    expect(stale.ok).toBe(false)
    if (stale.ok) throw new Error('the stale edit was accepted')
    expect(stale.reason).toContain('changed since baseRevision 1')
    expect(stale.current?.revision).toBe(2)
    expect(stale.current?.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses an install over an existing skill rather than overwriting it', async () => {
    const { db } = testDb()
    await seedOwner(db)
    const writer = writerFor({ db })
    await writer.write({
      scope: 'user',
      name: 'gamma',
      path: 'SKILL.md',
      body: ENTRY,
      description: 'does gamma',
      baseRevision: 0,
    })

    const again = await writer.write({
      scope: 'user',
      name: 'gamma',
      path: 'SKILL.md',
      body: ENTRY,
      description: null,
      baseRevision: 0,
    })
    expect(again.ok).toBe(false)
    if (again.ok) throw new Error('the second install was accepted')
    expect(again.current?.revision).toBe(1)
  })

  it('leaves the description alone when the edit touches a bundled file', async () => {
    const { db } = testDb()
    await seedOwner(db)
    const writer = writerFor({ db })
    await writer.write({
      scope: 'user',
      name: 'gamma',
      path: 'SKILL.md',
      body: ENTRY,
      description: 'does gamma',
      baseRevision: 0,
    })

    const bundled = await writer.write({
      scope: 'user',
      name: 'gamma',
      path: 'references/one.md',
      body: 'one',
      description: null,
      baseRevision: 0,
    })
    expect(bundled).toEqual({ ok: true, revision: 1 })

    const row = await db.orm.public.Skill.first({ userId: 'user-1', name: 'gamma' })
    expect(row?.description).toBe('does gamma')
    expect(
      await skillTextOf({
        db,
        owner: OWNER,
        scope: 'user',
        name: 'gamma',
        path: 'references/one.md',
      }),
    ).toEqual({ text: 'one', revision: 1, hash: expect.stringMatching(/^[0-9a-f]{64}$/) })
  })

  it('refuses a built-in name with a sentence naming why', async () => {
    const { db } = testDb()
    await seedOwner(db)
    const writer = writerFor({ db, builtInNames: ['commit'] })

    const outcome = await writer.remove({ scope: 'user', name: 'commit' })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('the built-in was removed')
    expect(outcome.reason).toContain('built in')
  })

  it('deletes the SkillFile rows with the Skill row', async () => {
    const { db } = testDb()
    await seedOwner(db)
    const writer = writerFor({ db })
    await writer.write({
      scope: 'user',
      name: 'gamma',
      path: 'SKILL.md',
      body: ENTRY,
      description: 'does gamma',
      baseRevision: 0,
    })
    await writer.write({
      scope: 'user',
      name: 'gamma',
      path: 'references/one.md',
      body: 'one',
      description: null,
      baseRevision: 0,
    })

    expect(await writer.remove({ scope: 'user', name: 'gamma' })).toEqual({ ok: true, revision: 0 })
    expect(await db.orm.public.Skill.first({ userId: 'user-1', name: 'gamma' })).toBeNull()
    expect(await db.orm.public.SkillFile.where({ path: 'SKILL.md' }).all()).toHaveLength(0)
    expect(await writer.remove({ scope: 'user', name: 'gamma' })).toMatchObject({ ok: false })
  })
})
