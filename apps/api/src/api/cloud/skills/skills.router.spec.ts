import { createHash } from 'node:crypto'
import type { INestApplication } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import {
  buildSessionTrpcApp,
  dataOf,
  errorMessageOf,
  trpcMutation,
  trpcQuery,
} from '../session-trpc-test-app'
import { GithubService } from '@dltech/atlas-github'
import { ProjectsService } from '../projects/projects.service'
import { SkillUsageService } from './skill-usage.service'
import { SkillsRouter } from './skills.router'
import { SkillsService } from './skills.service'

const USER_A = 'user-a'
const USER_B = 'user-b'

const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const fileOf = (text: string) => {
  const bytes = new TextEncoder().encode(text)
  return { content: encode(bytes), contentHash: createHash('sha256').update(bytes).digest('hex') }
}

const skillMd = (args: { name: string; description: string }) =>
  `---\nname: ${args.name}\ndescription: ${args.description}\n---\nbody\n`

describe('SkillsRouter', () => {
  useTestDatabase()
  let app: INestApplication

  const list = (token: string | undefined, input: Record<string, unknown>) =>
    trpcQuery({ app, path: 'skills.list', token, input })
  const put = (token: string | undefined, input: Record<string, unknown>) =>
    trpcMutation({ app, path: 'skills.put', token, input })

  const createProject = async (args: { ownerUserId: string; id: string }) => {
    await db.orm.public.Project.create({
      id: args.id,
      name: args.id,
      repo: 'o/r',
      ownerUserId: args.ownerUserId,
      createdById: args.ownerUserId,
    })
  }

  const seedLoads = async (args: {
    userId: string
    projectId?: string
    events: {
      type: 'context-loaded' | 'tool-called'
      body: Record<string, unknown>
      at?: Date
    }[]
  }) => {
    const sessionId = `ses-${args.userId}-${args.projectId ?? 'personal'}`
    const threadId = `thr-${args.userId}-${args.projectId ?? 'personal'}`
    const at = new Date()
    if ((await db.orm.v2.V2Session.first({ id: sessionId })) === null) {
      await db.orm.v2.V2Session.create({
        id: sessionId,
        userId: args.userId,
        projectId: args.projectId ?? null,
        mainThreadId: threadId,
        nextInboxId: 1,
        createdAt: at,
        modelRef: 'anthropic/claude-haiku-4-5',
        modelEffort: 'medium',
        modelFast: false,
      })
    }
    if ((await db.orm.v2.V2Thread.first({ id: threadId })) === null) {
      await db.orm.v2.V2Thread.create({
        id: threadId,
        sessionId,
        headSeq: 0,
        headHash: '',
        visibility: 'visible',
        createdAt: at,
      })
    }
    let seq = 0
    for (const event of args.events) {
      seq += 1
      await db.orm.v2.V2Event.create({
        threadId,
        seq,
        id: `evt-${threadId}-${seq}`,
        epoch: 1,
        type: event.type,
        runId: `run-${seq}`,
        at: event.at ?? at,
        prevHash: '',
        hash: `hash-${seq}`,
        canonical: JSON.stringify(event.body),
      })
    }
  }

  beforeAll(async () => {
    app = await buildSessionTrpcApp({
      providers: [
        SkillsRouter,
        SkillsService,
        SkillUsageService,
        ProjectsService,
        { provide: GithubService, useValue: { findToken: async () => undefined } },
      ],
    })
  })

  afterAll(() => app.close())

  beforeEach(async () => {
    await seedUser({ db, id: USER_A })
    await seedUser({ db, id: USER_B })
  })

  it('round-trips a personal skill: put, list with usage, listFiles, get, remove', async () => {
    const written = await put('session-a', {
      scope: 'personal',
      skill: 'review',
      path: 'SKILL.md',
      ...fileOf(skillMd({ name: 'review', description: 'review code' })),
    }).expect(200)
    expect(dataOf(written.body)).toEqual({ revision: 1 })

    await put('session-a', {
      scope: 'personal',
      skill: 'review',
      path: 'references/checklist.md',
      ...fileOf('check the diff'),
    }).expect(200)

    const listed = await list('session-a', { scope: 'personal' }).expect(200)
    const rows = (dataOf(listed.body) as { skills: { name: string }[] }).skills.filter(
      (skill) => skill.name === 'review',
    )
    expect(rows).toMatchObject([
      {
        name: 'review',
        description: 'review code',
        fileCount: 2,
        usage: { usedCount30d: 0, lastUsedAt: null },
        origin: 'personal',
        overridesBuiltIn: false,
      },
    ])

    const files = await trpcQuery({
      app,
      path: 'skills.listFiles',
      token: 'session-a',
      input: { scope: 'personal', skill: 'review' },
    }).expect(200)
    expect(dataOf(files.body)).toMatchObject({
      files: [
        { path: 'SKILL.md', revision: 1, isText: true },
        { path: 'references/checklist.md', revision: 1, isText: true },
      ],
    })

    const got = await trpcQuery({
      app,
      path: 'skills.get',
      token: 'session-a',
      input: { scope: 'personal', skill: 'review', path: 'references/checklist.md' },
    }).expect(200)
    expect(dataOf(got.body)).toMatchObject({
      path: 'references/checklist.md',
      content: fileOf('check the diff').content,
    })

    const removed = await trpcMutation({
      app,
      path: 'skills.remove',
      token: 'session-a',
      input: {
        scope: 'personal',
        skill: 'review',
        path: 'references/checklist.md',
        baseRevision: 1,
      },
    }).expect(200)
    expect(dataOf(removed.body)).toEqual({ removed: true })
  })

  it('answers 409 with the current revision on a stale baseRevision', async () => {
    await put('session-a', {
      scope: 'personal',
      skill: 'review',
      path: 'SKILL.md',
      ...fileOf('one'),
    }).expect(200)

    const stale = await put('session-a', {
      scope: 'personal',
      skill: 'review',
      path: 'SKILL.md',
      baseRevision: 0,
      ...fileOf('two'),
    }).expect(409)
    expect(errorMessageOf(stale.body)).toBe('the file changed since baseRevision')
  })

  it('clears the description after SKILL.md is removed', async () => {
    await put('session-a', {
      scope: 'personal',
      skill: 'review',
      path: 'SKILL.md',
      ...fileOf(skillMd({ name: 'review', description: 'review code' })),
    }).expect(200)
    await put('session-a', {
      scope: 'personal',
      skill: 'review',
      path: 'notes.md',
      ...fileOf('notes'),
    }).expect(200)

    await trpcMutation({
      app,
      path: 'skills.remove',
      token: 'session-a',
      input: { scope: 'personal', skill: 'review', path: 'SKILL.md', baseRevision: 1 },
    }).expect(200)

    const listed = await list('session-a', { scope: 'personal' }).expect(200)
    const rows = (dataOf(listed.body) as { skills: { name: string }[] }).skills.filter(
      (skill) => skill.name === 'review',
    )
    expect(rows).toMatchObject([{ name: 'review', description: '' }])
  })

  it('round-trips a binary (non-utf8) file', async () => {
    const bytes = new Uint8Array([0x00, 0xff, 0xfe, 0x0a, 0x0d])
    await put('session-a', {
      scope: 'personal',
      skill: 'icons',
      path: 'assets/logo.bin',
      content: encode(bytes),
      contentHash: createHash('sha256').update(bytes).digest('hex'),
    }).expect(200)

    const got = await trpcQuery({
      app,
      path: 'skills.get',
      token: 'session-a',
      input: { scope: 'personal', skill: 'icons', path: 'assets/logo.bin' },
    }).expect(200)
    expect(dataOf(got.body)).toMatchObject({
      isText: false,
      sizeBytes: bytes.byteLength,
      content: encode(bytes),
    })
  })

  it('rejects an invalid skill name', async () => {
    const invalid = await put('session-a', {
      scope: 'personal',
      skill: 'Review_Stuff',
      path: 'SKILL.md',
      ...fileOf('x'),
    })
    expect(invalid.status).toBe(400)
  })

  it('removeSkill cascades the files and reports the count', async () => {
    await put('session-a', {
      scope: 'personal',
      skill: 'review',
      path: 'SKILL.md',
      ...fileOf(skillMd({ name: 'review', description: 'r' })),
    }).expect(200)
    await put('session-a', {
      scope: 'personal',
      skill: 'review',
      path: 'a.md',
      ...fileOf('a'),
    }).expect(200)

    const removed = await trpcMutation({
      app,
      path: 'skills.removeSkill',
      token: 'session-a',
      input: { scope: 'personal', skill: 'review' },
    }).expect(200)
    expect(dataOf(removed.body)).toEqual({ removed: 2 })

    const listed = await list('session-a', { scope: 'personal' }).expect(200)
    const skills = (dataOf(listed.body) as { skills: { name: string }[] }).skills
    expect(skills.some((skill) => skill.name === 'review')).toBe(false)
  })

  it('scopes project skills to the project and 404s for a project the user does not own', async () => {
    await createProject({ ownerUserId: USER_A, id: 'proj-a' })

    await put('session-a', {
      scope: 'project',
      projectId: 'proj-a',
      skill: 'deploy',
      path: 'SKILL.md',
      ...fileOf(skillMd({ name: 'deploy', description: 'project deploy' })),
    }).expect(200)

    const ownerListed = await list('session-a', { scope: 'project', projectId: 'proj-a' }).expect(
      200,
    )
    expect(dataOf(ownerListed.body)).toMatchObject({ skills: [{ name: 'deploy' }] })

    await list('session-b', { scope: 'project', projectId: 'proj-a' }).expect(404)
    await put('session-b', {
      scope: 'project',
      projectId: 'proj-a',
      skill: 'deploy',
      path: 'SKILL.md',
      ...fileOf('evil'),
    }).expect(404)

    const personal = await list('session-b', { scope: 'personal' }).expect(200)
    const rows = (dataOf(personal.body) as { skills: { origin: string }[] }).skills.filter(
      (skill) => skill.origin === 'personal',
    )
    expect(rows).toEqual([])
  })

  it('rejects scope=project without a projectId', async () => {
    await list('session-a', { scope: 'project' }).expect(400)
  })

  it('attributes usage from tool-called and context-loaded events per scope', async () => {
    await put('session-a', {
      scope: 'personal',
      skill: 'review',
      path: 'SKILL.md',
      ...fileOf(skillMd({ name: 'review', description: 'r' })),
    }).expect(200)
    await createProject({ ownerUserId: USER_A, id: 'proj-a' })
    await put('session-a', {
      scope: 'project',
      projectId: 'proj-a',
      skill: 'deploy',
      path: 'SKILL.md',
      ...fileOf(skillMd({ name: 'deploy', description: 'd' })),
    }).expect(200)

    const recent = new Date(Date.now() - 60 * 60 * 1_000)
    const earlier = new Date(Date.now() - 2 * 60 * 60 * 1_000)
    const old = new Date(Date.now() - 45 * 24 * 60 * 60 * 1_000)
    await seedLoads({
      userId: USER_A,
      events: [
        {
          type: 'context-loaded',
          body: { slot: 'skill', key: 'review', content: 'body' },
          at: earlier,
        },
        {
          type: 'tool-called',
          body: { name: 'skill', input: { name: 'review' }, ordinal: 0 },
          at: recent,
        },
        {
          type: 'tool-called',
          body: { name: 'skill', input: { name: 'stale' }, ordinal: 0 },
          at: old,
        },
        { type: 'tool-called', body: { name: 'bash', input: {}, ordinal: 0 } },
        {
          type: 'tool-called',
          body: { name: 'skill', input: { name: 'review' }, ordinal: 0, output: 'nul \u0000 byte' },
        },
      ],
    })
    await seedLoads({
      userId: USER_A,
      projectId: 'proj-a',
      events: [
        {
          type: 'tool-called',
          body: { name: 'skill', input: { name: 'deploy' }, ordinal: 0 },
          at: recent,
        },
      ],
    })
    await seedLoads({
      userId: USER_B,
      events: [
        {
          type: 'tool-called',
          body: { name: 'skill', input: { name: 'review' }, ordinal: 0 },
          at: recent,
        },
      ],
    })

    const personal = await list('session-a', { scope: 'personal' }).expect(200)
    const review = (dataOf(personal.body) as { skills: { usage: unknown }[] }).skills[0]
    expect(review?.usage).toEqual({ usedCount30d: 2, lastUsedAt: recent.toISOString() })

    const project = await list('session-a', { scope: 'project', projectId: 'proj-a' }).expect(200)
    const deploy = (dataOf(project.body) as { skills: { usage: unknown }[] }).skills[0]
    expect(deploy?.usage).toEqual({ usedCount30d: 1, lastUsedAt: recent.toISOString() })
  })

  it('derives and persists an empty description from SKILL.md on list', async () => {
    const text = skillMd({ name: 'review', description: 'backfilled from frontmatter' })
    const entry = fileOf(text)
    const skill = await db.orm.public.Skill.create({ userId: USER_A, name: 'review' })
    await db.orm.public.SkillFile.create({
      skillId: skill.id,
      path: 'SKILL.md',
      revision: 1,
      contentHash: entry.contentHash,
      content: new TextEncoder().encode(text),
      isText: true,
      size: Buffer.byteLength(text),
    })
    expect(skill.description).toBe('')

    const listed = await list('session-a', { scope: 'personal' }).expect(200)
    const row = (
      dataOf(listed.body) as { skills: { name: string; description: string }[] }
    ).skills.find((candidate) => candidate.name === 'review')
    expect(row?.description).toBe('backfilled from frontmatter')

    const persisted = await db.orm.public.Skill.first({ id: skill.id })
    expect(persisted?.description).toBe('backfilled from frontmatter')
  })

  it('does not touch a description that is already set on list', async () => {
    const text = skillMd({ name: 'review', description: 'new frontmatter' })
    const entry = fileOf(text)
    const skill = await db.orm.public.Skill.create({
      userId: USER_A,
      name: 'review',
      description: 'hand-written description',
    })
    await db.orm.public.SkillFile.create({
      skillId: skill.id,
      path: 'SKILL.md',
      revision: 1,
      contentHash: entry.contentHash,
      content: new TextEncoder().encode(text),
      isText: true,
      size: Buffer.byteLength(text),
    })

    const listed = await list('session-a', { scope: 'personal' }).expect(200)
    const row = (
      dataOf(listed.body) as { skills: { name: string; description: string }[] }
    ).skills.find((candidate) => candidate.name === 'review')
    expect(row?.description).toBe('hand-written description')

    const persisted = await db.orm.public.Skill.first({ id: skill.id })
    expect(persisted?.description).toBe('hand-written description')
  })

  it('lists built-in skills on the personal scope with the built-in origin', async () => {
    const listed = await list('session-a', { scope: 'personal' }).expect(200)
    const skills = (
      dataOf(listed.body) as {
        skills: { name: string; origin: string; overridesBuiltIn: boolean }[]
      }
    ).skills
    const builtIn = skills.filter((skill) => skill.origin === 'built-in')
    for (const name of ['atlas', 'commit', 'resolving-merge-conflicts', 'ui-design', 'video']) {
      expect(builtIn.some((skill) => skill.name === name)).toBe(true)
    }
    expect(builtIn.every((skill) => skill.overridesBuiltIn === false)).toBe(true)
  })

  it('does not list built-in skills on the project scope', async () => {
    await createProject({ ownerUserId: USER_A, id: 'proj-a' })
    const listed = await list('session-a', { scope: 'project', projectId: 'proj-a' }).expect(200)
    const skills = (dataOf(listed.body) as { skills: { origin: string }[] }).skills
    expect(skills.some((skill) => skill.origin === 'built-in')).toBe(false)
  })

  it('serves a built-in file read-only on the personal scope', async () => {
    const files = await trpcQuery({
      app,
      path: 'skills.listFiles',
      token: 'session-a',
      input: { scope: 'personal', skill: 'commit' },
    }).expect(200)
    expect(dataOf(files.body)).toMatchObject({ files: [{ path: 'SKILL.md', isText: true }] })

    const got = await trpcQuery({
      app,
      path: 'skills.get',
      token: 'session-a',
      input: { scope: 'personal', skill: 'commit', path: 'SKILL.md' },
    }).expect(200)
    const content = Buffer.from(
      (dataOf(got.body) as { content: string }).content,
      'base64',
    ).toString('utf8')
    expect(content).toContain('name: commit')
  })

  it('rejects writes to a built-in skill name with no personal row', async () => {
    const written = await put('session-a', {
      scope: 'personal',
      skill: 'commit',
      path: 'SKILL.md',
      ...fileOf('override attempt'),
    })
    expect(written.status).toBe(400)

    const removed = await trpcMutation({
      app,
      path: 'skills.removeSkill',
      token: 'session-a',
      input: { scope: 'personal', skill: 'commit' },
    })
    expect(removed.status).toBe(404)
  })

  it('lets an existing personal skill shadow a built-in as a normal editable row', async () => {
    const skill = await db.orm.public.Skill.create({ userId: USER_A, name: 'commit' })
    const entry = fileOf(skillMd({ name: 'commit', description: 'my own commit skill' }))
    await db.orm.public.SkillFile.create({
      skillId: skill.id,
      path: 'SKILL.md',
      revision: 1,
      contentHash: entry.contentHash,
      content: new TextEncoder().encode(
        skillMd({ name: 'commit', description: 'my own commit skill' }),
      ),
      isText: true,
      size: Buffer.byteLength(skillMd({ name: 'commit', description: 'my own commit skill' })),
    })

    const listed = await list('session-a', { scope: 'personal' }).expect(200)
    const rows = (
      dataOf(listed.body) as {
        skills: { name: string; origin: string; overridesBuiltIn: boolean; description: string }[]
      }
    ).skills.filter((row) => row.name === 'commit')
    expect(rows).toMatchObject([
      {
        name: 'commit',
        origin: 'personal',
        overridesBuiltIn: true,
        description: 'my own commit skill',
      },
    ])

    const edited = await put('session-a', {
      scope: 'personal',
      skill: 'commit',
      path: 'SKILL.md',
      baseRevision: 1,
      ...fileOf(skillMd({ name: 'commit', description: 'edited override' })),
    }).expect(200)
    expect(dataOf(edited.body)).toEqual({ revision: 2 })

    const removed = await trpcMutation({
      app,
      path: 'skills.removeSkill',
      token: 'session-a',
      input: { scope: 'personal', skill: 'commit' },
    }).expect(200)
    expect(dataOf(removed.body)).toEqual({ removed: 1 })

    const after = await list('session-a', { scope: 'personal' }).expect(200)
    const restored = (
      dataOf(after.body) as { skills: { name: string; origin: string }[] }
    ).skills.filter((row) => row.name === 'commit')
    expect(restored).toMatchObject([{ name: 'commit', origin: 'built-in' }])
  })
})
