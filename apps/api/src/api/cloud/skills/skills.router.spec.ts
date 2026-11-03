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
import { GithubService } from '../github/github.service'
import { ProjectsService } from '../projects/projects.service'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import { inertSignals } from '../../platform/sessions/thread-signals.fixture'
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

  const seedEvents = async (args: {
    userId: string
    events: {
      type: string
      body: string
      contextSlot?: string
      contextKey?: string
      projectId?: string
      at?: Date
    }[]
  }) => {
    let seq = 0
    for (const event of args.events) {
      const projectId = event.projectId
      const threadId = `thr-${args.userId}-${projectId ?? 'personal'}-${seq}`
      const sessionId = `ses-${args.userId}-${projectId ?? 'personal'}`
      const existingSession = await db.orm.public.Session.first({ id: sessionId })
      if (existingSession === null) {
        await db.orm.public.Session.create({
          id: sessionId,
          userId: args.userId,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...(projectId === undefined ? {} : { projectId }),
        })
      }
      const existingThread = await db.orm.public.Thread.first({ id: threadId })
      if (existingThread === null) {
        await db.orm.public.Thread.create({
          id: threadId,
          userId: args.userId,
          sessionId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      }
      seq += 1
      await db.orm.public.Event.create({
        id: `evt-${args.userId}-${seq}-${event.contextKey ?? event.type}`,
        threadId,
        seq,
        runId: `run-${seq}`,
        depth: 0,
        at: event.at ?? new Date(),
        type: event.type,
        body: event.body,
        userId: args.userId,
        ...(event.contextSlot === undefined ? {} : { contextSlot: event.contextSlot }),
        ...(event.contextKey === undefined ? {} : { contextKey: event.contextKey }),
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
        { provide: ThreadSignalsService, useValue: inertSignals() },
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

    const old = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)
    await seedEvents({
      userId: USER_A,
      events: [
        { type: 'context-loaded', body: '{}', contextSlot: 'skill', contextKey: 'review' },
        {
          type: 'tool-called',
          body: JSON.stringify({ name: 'skill', input: { name: 'review' } }),
        },
        {
          type: 'tool-called',
          body: JSON.stringify({ name: 'skill', input: { name: 'deploy' } }),
          projectId: 'proj-a',
        },
        {
          type: 'tool-called',
          body: JSON.stringify({ name: 'skill', input: { name: 'stale' } }),
          at: old,
        },
        { type: 'tool-called', body: JSON.stringify({ name: 'bash', input: {} }) },
        {
          type: 'tool-called',
          body: '{"name":"skill","input":{"name":"review"},"output":"nul \\u0000 byte"}',
        },
      ],
    })
    await seedEvents({
      userId: USER_B,
      events: [
        {
          type: 'tool-called',
          body: JSON.stringify({ name: 'skill', input: { name: 'review' } }),
        },
      ],
    })

    const personal = await list('session-a', { scope: 'personal' }).expect(200)
    const review = (dataOf(personal.body) as { skills: { usage: unknown }[] }).skills[0]
    expect(review?.usage).toEqual({ usedCount30d: 2, lastUsedAt: expect.any(String) })

    const project = await list('session-a', { scope: 'project', projectId: 'proj-a' }).expect(200)
    const deploy = (dataOf(project.body) as { skills: { usage: unknown }[] }).skills[0]
    expect(deploy?.usage).toMatchObject({ usedCount30d: 1 })
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
