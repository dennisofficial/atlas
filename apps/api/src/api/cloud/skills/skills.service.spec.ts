import { db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { GithubService } from '@dltech/atlas-github'
import { ESkillScope } from '@dltech/atlas-wire'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import type { INestApplication } from '@nestjs/common'
import { buildSessionTrpcApp } from '../session-trpc-test-app'
import { GroupsService } from '../project-groups/project-groups.service'
import { ProjectsService } from '../projects/projects.service'
import { SkillUsageService } from './skill-usage.service'
import { SkillsService } from './skills.service'

const USER = 'skills-reader'
const scope = { userId: USER, scope: ESkillScope.Personal }

describe('SkillsService separate usage', () => {
  useTestDatabase()
  let app: INestApplication
  let skills: SkillsService
  const usage = new SkillUsageService()
  let usageSpy: ReturnType<typeof spyOn<SkillUsageService, 'usageFor'>>

  beforeAll(async () => {
    app = await buildSessionTrpcApp({
      providers: [
        SkillsService,
        { provide: SkillUsageService, useValue: usage },
        ProjectsService,
        GroupsService,
        { provide: GithubService, useValue: { findToken: async () => undefined } },
      ],
    })
    skills = app.get(SkillsService)
  })
  afterAll(() => app.close())
  beforeEach(async () => {
    await seedUser({ db, id: USER })
    await db.orm.public.Skill.create({ userId: USER, name: 'review', description: 'Review code' })
    usageSpy = spyOn(usage, 'usageFor')
  })
  afterEach(() => usageSpy.mockRestore())

  it('returns list and layers without calling usage even when usage never settles', async () => {
    usageSpy.mockImplementation(() => new Promise(() => {}))
    const list = await skills.list(scope)
    const layered = await skills.layered(scope)
    expect(usageSpy).not.toHaveBeenCalled()
    expect(list.find((skill) => skill.name === 'review')).toMatchObject({
      name: 'review',
      usagePending: true,
      usage: { usedCount30d: 0, lastUsedAt: null },
    })
    expect(
      layered.layers.flatMap((layer) => layer.items).every((skill) => skill.usagePending),
    ).toBe(true)
  })

  it('returns usage separately and fills unused skills with zero', async () => {
    const lastUsedAt = '2026-11-27T12:00:00.000Z'
    usageSpy.mockResolvedValue(new Map([['review', { usedCount30d: 7, lastUsedAt }]]))
    const result = await skills.usageFor(scope)
    expect(result.usage.review).toEqual({ usedCount30d: 7, lastUsedAt })
    expect(result.usage.commit).toEqual({ usedCount30d: 0, lastUsedAt: null })
    expect(usageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        ...scope,
        skillNames: expect.arrayContaining(['review', 'commit']),
      }),
    )
  })

  it('checks scope ownership before starting the scan', async () => {
    usageSpy.mockResolvedValue(new Map())
    await expect(
      skills.usageFor({ ...scope, scope: ESkillScope.Project, projectId: 'missing' }),
    ).rejects.toThrow('project not found')
    await expect(
      skills.usageFor({ ...scope, scope: ESkillScope.Group, groupId: 'missing' }),
    ).rejects.toThrow('group not found')
    expect(usageSpy).not.toHaveBeenCalled()
  })
})
