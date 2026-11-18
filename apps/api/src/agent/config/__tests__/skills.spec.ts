import { describe, expect, it } from 'bun:test'

import { toThreadId, type Assembled } from '@dltech/atlas-core'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import type { Db } from '@dltech/atlas-db'
import { SKILL_LISTING_HEADING, skillsPodOf } from '@dltech/atlas-plugin-skills/pod'
import { seedOwner, seedSkill } from './config-reader.fixture'
import { podContextOf } from '../../testing/pod-context'
import { skillCloudPort } from '../skills'

const testDb = useTestDatabase()

const SESSION = 's-1'

const ENTRY = '---\nname: gamma\ndescription: does gamma\n---\n\ngamma body'

const readAs = async (args: {
  db: Db
}): Promise<{ listing: string; load: (name: string) => Promise<string> }> => {
  const port = skillCloudPort({ db: args.db })
  const pod = skillsPodOf({ cloud: port.source(SESSION), writes: port.writer(SESSION) })
  const ctx = podContextOf(SESSION)
  const hooks = pod.hooks?.(ctx)
  for (const hook of hooks?.beforeTurn ?? [])
    await hook.run({ threadId: toThreadId('t-1'), projectDirectory: '/repo' })
  let assembled: Assembled = { system: [], messages: [] }
  for (const hook of hooks?.beforeStep ?? []) assembled = await hook.run({ assembled, trace: [] })
  const tool = pod.tools?.(ctx).find((candidate) => candidate.name === 'skill')
  if (tool === undefined) throw new Error('the pod offers no skill tool')
  return {
    listing: assembled.system.map((block) => block.text).join('\n'),
    load: async (name) => {
      const outcome = await tool.invoke({
        input: { name },
        signal: new AbortController().signal,
        idempotencyKey: 'k',
        projectDirectory: '/repo',
        threadId: toThreadId('t-1'),
      })
      return outcome.ok ? outcome.modelText : outcome.reason
    },
  }
}

describe('the cloud skill port', () => {
  it('lists the user and project rows and loads each SKILL.md', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedSkill({ db, name: 'alpha', scope: 'user' })
    await seedSkill({ db, name: 'beta', scope: 'project' })
    const source = skillCloudPort({ db }).source(SESSION)

    const texts = await source.frontmatter()
    expect(texts.map((one) => `${one.scope}:${one.name}`).sort()).toEqual([
      'project:beta',
      'user:alpha',
    ])
    expect(
      source
        .entries()
        .map((one) => `${one.scope}:${one.name}`)
        .sort(),
    ).toEqual(['project:beta', 'user:alpha'])
    expect(await source.body({ name: 'alpha', description: 'a', scope: 'user' })).toMatchObject({
      text: 'body',
      revision: 1,
    })
    expect(
      await source.file({ name: 'alpha', description: 'a', scope: 'user' }, 'nope.md'),
    ).toBeNull()
  })

  it('writes a skill the source sees on its next read, refuses a stale edit, and removes it', async () => {
    const { db } = testDb()
    await seedOwner(db)
    const port = skillCloudPort({ db })
    const source = port.source(SESSION)
    const writer = port.writer(SESSION)

    expect(
      await writer.write({
        scope: 'user',
        name: 'gamma',
        path: 'SKILL.md',
        body: ENTRY,
        description: 'does gamma',
        baseRevision: 0,
      }),
    ).toEqual({ ok: true, revision: 1 })

    await source.frontmatter()
    expect(source.entries().map((one) => one.name)).toContain('gamma')

    expect(
      await writer.write({
        scope: 'user',
        name: 'gamma',
        path: 'SKILL.md',
        body: `${ENTRY}\nmore`,
        description: 'does gamma',
        baseRevision: 0,
      }),
    ).toMatchObject({ ok: false, current: { revision: 1 } })

    expect(await writer.remove({ scope: 'user', name: 'gamma' })).toEqual({
      ok: true,
      revision: 0,
    })
    await source.frontmatter()
    expect(source.entries().map((one) => one.name)).not.toContain('gamma')
  })

  it('keeps a built-in out of reach of the writer', async () => {
    const { db } = testDb()
    await seedOwner(db)

    expect(
      await skillCloudPort({ db }).writer(SESSION).write({
        scope: 'user',
        name: 'commit',
        path: 'SKILL.md',
        body: ENTRY,
        description: null,
        baseRevision: 0,
      }),
    ).toMatchObject({ ok: false })
  })

  it('answers empty and refuses to write for a session that does not exist', async () => {
    const { db } = testDb()
    await seedOwner(db)
    const port = skillCloudPort({ db })
    const source = port.source('s-missing')

    expect(await source.frontmatter()).toEqual([])
    expect(source.entries()).toEqual([])
    expect(await source.body({ name: 'alpha', description: 'a', scope: 'user' })).toBeNull()
    expect(await port.writer('s-missing').remove({ scope: 'user', name: 'alpha' })).toMatchObject({
      ok: false,
    })
  })
})

describe('the skills pod over the cloud port', () => {
  it('renders the cloud skills and the built-ins in the listing and loads a cloud skill', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedSkill({ db, name: 'alpha', scope: 'user' })
    const session = await readAs({ db })

    expect(session.listing).toContain(SKILL_LISTING_HEADING)
    expect(session.listing).toContain('- alpha: alpha description')
    expect(session.listing).toContain('- commit:')
    expect(await session.load('alpha')).toContain('body')
  })
})
