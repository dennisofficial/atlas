import { BadRequestException, NotFoundException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GithubService } from '../github/github.service'
import { seedWorkspace } from '../web-settings.fake-db'
import type { SaveProjectDto } from './projects.dto'
import { ProjectsService } from './projects.service'
import { WorkspaceAccessService } from '../workspaces/workspace-access.service'

const USER_A = 'user-a'
const USER_B = 'user-b'
const USER_C = 'user-c'
const ORG = 'org-1'

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5))
const projectRows = () => db.orm.public.Project.where((row) => row.id.neq('')).all()

const input = (partial: Partial<SaveProjectDto> = {}): SaveProjectDto => ({
  name: 'atlas',
  repo: 'dennisofficial/atlas',
  baseBranch: 'main',
  additionalRepos: [{ repo: 'octocat/Spoon-Knife', branch: 'test-branch' }, { repo: 'octocat/docs' }],
  ...partial,
})

describe('ProjectsService', () => {
  const database = useTestDatabase()
  let tokens: Record<string, string | undefined>
  let service: ProjectsService

  beforeEach(async () => {
    for (const id of [USER_A, USER_B, USER_C]) await seedUser({ db: database().db, id })
    tokens = { [USER_A]: 'gho_user-a' }
    const github = { findToken: vi.fn(async (args: { userId: string }) => tokens[args.userId]) }
    service = new ProjectsService(github as unknown as GithubService, new WorkspaceAccessService())
  })

  it('creates, reads, lists, replaces and removes a project', async () => {
    const created = await service.create({ userId: USER_A, input: input() })

    expect(created).toMatchObject({
      name: 'atlas',
      repo: 'dennisofficial/atlas',
      baseBranch: 'main',
      additionalRepos: [{ repo: 'octocat/Spoon-Knife', branch: 'test-branch' }, { repo: 'octocat/docs' }],
    })
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/)
    expect(await service.read({ userId: USER_A, projectId: created.id })).toEqual(created)
    expect(await service.list({ userId: USER_A })).toEqual([created])

    await tick()
    const replaced = await service.replace({
      userId: USER_A,
      projectId: created.id,
      input: input({ name: 'renamed', repo: null, baseBranch: null, additionalRepos: [] }),
    })
    expect(replaced).toMatchObject({ id: created.id, name: 'renamed', repo: null, additionalRepos: [] })
    expect(replaced.updatedAt > created.updatedAt).toBe(true)

    await service.remove({ userId: USER_A, projectId: created.id })
    expect(await projectRows()).toHaveLength(0)
  })

  it('stores additional repos as plain {repo, branch?} entries without undefined branches', async () => {
    await service.create({ userId: USER_A, input: input() })

    expect((await projectRows())[0]?.additionalRepos).toStrictEqual([
      { repo: 'octocat/Spoon-Knife', branch: 'test-branch' },
      { repo: 'octocat/docs' },
    ])
  })

  it('lists newest-updated first and only the caller’s own projects', async () => {
    const first = await service.create({ userId: USER_A, input: input({ name: 'first' }) })
    await tick()
    const second = await service.create({ userId: USER_A, input: input({ name: 'second', repo: 'a/b', additionalRepos: [] }) })
    await service.create({ userId: USER_B, input: input({ name: 'theirs' }) })

    expect((await service.list({ userId: USER_A })).map((p) => p.id)).toEqual([second.id, first.id])
  })

  it("answers 404 for another user's project on read, replace, remove and workspace", async () => {
    const created = await service.create({ userId: USER_A, input: input() })
    const foreign = { userId: USER_B, projectId: created.id }

    await expect(service.read(foreign)).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.replace({ ...foreign, input: input() })).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.remove(foreign)).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.workspace(foreign)).rejects.toBeInstanceOf(NotFoundException)
    const rows = await projectRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('atlas')
  })

  it('answers the workspace with the token brokered from the owner’s github connection', async () => {
    const created = await service.create({ userId: USER_A, input: input() })

    expect(await service.workspace({ userId: USER_A, projectId: created.id })).toEqual({
      projectId: created.id,
      repo: 'dennisofficial/atlas',
      baseBranch: 'main',
      additionalRepos: [{ repo: 'octocat/Spoon-Knife', branch: 'test-branch' }, { repo: 'octocat/docs' }],
      githubToken: 'gho_user-a',
    })
  })

  it('answers githubToken null when the owner has no github connection', async () => {
    const created = await service.create({ userId: USER_B, input: input() })

    const workspace = await service.workspace({ userId: USER_B, projectId: created.id })

    expect(workspace.githubToken).toBeNull()
  })

  it('falls back to no additional repos when the stored column is malformed', async () => {
    const created = await service.create({ userId: USER_A, input: input() })
    await db.orm.public.Project.where({ id: created.id }).update({ additionalRepos: { not: 'an array' } })

    expect((await service.read({ userId: USER_A, projectId: created.id })).additionalRepos).toEqual([])
  })

  it('rejects additional repos without a primary repo', async () => {
    await expect(
      service.create({ userId: USER_A, input: input({ repo: null, baseBranch: null }) }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(await projectRows()).toHaveLength(0)
  })

  it('rejects duplicate repo names across primary and extras, case-insensitively, on create and replace', async () => {
    const clash = input({ additionalRepos: [{ repo: 'someone/Atlas' }] })
    await expect(service.create({ userId: USER_A, input: clash })).rejects.toBeInstanceOf(BadRequestException)

    const created = await service.create({ userId: USER_A, input: input() })
    await expect(
      service.replace({ userId: USER_A, projectId: created.id, input: clash }),
    ).rejects.toBeInstanceOf(BadRequestException)
    const twice = input({ additionalRepos: [{ repo: 'a/x' }, { repo: 'b/X' }] })
    await expect(
      service.replace({ userId: USER_A, projectId: created.id, input: twice }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect((await projectRows())[0]?.additionalRepos).toHaveLength(2)
  })

  describe('ownership', () => {
    const workspaceInput = () => input({ organizationId: ORG, additionalRepos: [] })

    beforeEach(async () => {
      await seedWorkspace({
        id: ORG,
        members: [
          { userId: USER_A, role: 'owner' },
          { userId: USER_B, role: 'member' },
        ],
      })
    })

    it('stores a personal project under ownerUserId with createdById, and no organization', async () => {
      const created = await service.create({ userId: USER_A, input: input() })

      const row = await db.orm.public.Project.first({ id: created.id })
      expect(row).toMatchObject({ ownerUserId: USER_A, organizationId: null, createdById: USER_A })
    })

    it('stores a workspace project under organizationId with createdById, and no owner', async () => {
      const created = await service.create({ userId: USER_B, input: workspaceInput() })

      const row = await db.orm.public.Project.first({ id: created.id })
      expect(row).toMatchObject({ ownerUserId: null, organizationId: ORG, createdById: USER_B })
    })

    it('lets a co-member list, read and replace a workspace project another member created', async () => {
      const created = await service.create({ userId: USER_A, input: workspaceInput() })

      expect((await service.list({ userId: USER_B })).map((project) => project.id)).toEqual([created.id])
      expect(await service.read({ userId: USER_B, projectId: created.id })).toEqual(created)
      const replaced = await service.replace({
        userId: USER_B,
        projectId: created.id,
        input: { ...workspaceInput(), name: 'by-b' },
      })
      expect(replaced).toMatchObject({ id: created.id, name: 'by-b', organizationId: ORG })
      expect((await db.orm.public.Project.first({ id: created.id }))?.createdById).toBe(USER_A)
    })

    it('lists personal projects together with every workspace project the caller belongs to', async () => {
      const personal = await service.create({ userId: USER_B, input: input({ name: 'mine' }) })
      await tick()
      const shared = await service.create({ userId: USER_A, input: workspaceInput() })
      await service.create({ userId: USER_A, input: input({ name: 'a-private' }) })

      expect((await service.list({ userId: USER_B })).map((project) => project.id)).toEqual([
        shared.id,
        personal.id,
      ])
    })

    it('hides a personal project from a non-member and from a workspace co-member alike', async () => {
      const created = await service.create({ userId: USER_A, input: input() })
      const foreign = { userId: USER_B, projectId: created.id }

      expect(await service.list({ userId: USER_B })).toEqual([])
      await expect(service.read(foreign)).rejects.toBeInstanceOf(NotFoundException)
      await expect(service.workspace(foreign)).rejects.toBeInstanceOf(NotFoundException)
    })

    it('hides a workspace project from a non-member and refuses their edits', async () => {
      const created = await service.create({ userId: USER_A, input: workspaceInput() })
      const outsider = { userId: USER_C, projectId: created.id }

      expect(await service.list({ userId: USER_C })).toEqual([])
      await expect(service.read(outsider)).rejects.toBeInstanceOf(NotFoundException)
      await expect(service.replace({ ...outsider, input: workspaceInput() })).rejects.toBeInstanceOf(
        NotFoundException,
      )
      await expect(service.remove(outsider)).rejects.toBeInstanceOf(NotFoundException)
      expect(await projectRows()).toHaveLength(1)
    })

    it('lets a co-member remove a workspace project', async () => {
      const created = await service.create({ userId: USER_A, input: workspaceInput() })

      await service.remove({ userId: USER_B, projectId: created.id })

      expect(await projectRows()).toHaveLength(0)
    })

    it('refuses to create in a workspace the caller does not belong to', async () => {
      await expect(service.create({ userId: USER_C, input: workspaceInput() })).rejects.toBeInstanceOf(
        NotFoundException,
      )
      expect(await projectRows()).toHaveLength(0)
    })

    it('moves ownership with the link: unlinking makes the replacer the personal owner', async () => {
      const created = await service.create({ userId: USER_A, input: workspaceInput() })

      await service.replace({
        userId: USER_B,
        projectId: created.id,
        input: input({ organizationId: null }),
      })

      expect(await db.orm.public.Project.first({ id: created.id })).toMatchObject({
        ownerUserId: USER_B,
        organizationId: null,
      })
    })
  })
})
