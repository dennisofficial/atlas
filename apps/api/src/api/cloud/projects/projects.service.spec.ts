import { BadRequestException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GithubService } from '../github/github.service'
import type { SaveProjectDto } from './projects.dto'
import { projectRows, resetProjectRows } from './projects.fakes'
import { ProjectsService } from './projects.service'
import { WorkspaceAccessService } from '../workspaces/workspace-access.service'

vi.mock('../../../db', async () => {
  const { fakeProjectDb } = await import('./projects.fakes')
  return { db: fakeProjectDb() }
})

const USER_A = 'user-a'
const USER_B = 'user-b'

const input = (partial: Partial<SaveProjectDto> = {}): SaveProjectDto => ({
  name: 'atlas',
  repo: 'dennisofficial/atlas',
  baseBranch: 'main',
  additionalRepos: [
    { repo: 'octocat/Spoon-Knife', branch: 'test-branch' },
    { repo: 'octocat/docs' },
  ],
  ...partial,
})

describe('ProjectsService', () => {
  let tokens: Record<string, string | undefined>
  let service: ProjectsService

  beforeEach(() => {
    resetProjectRows()
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
      additionalRepos: [
        { repo: 'octocat/Spoon-Knife', branch: 'test-branch' },
        { repo: 'octocat/docs' },
      ],
    })
    expect(created.createdAt).toBe('2026-10-20T12:00:01.000Z')
    expect(await service.read({ userId: USER_A, projectId: created.id })).toEqual(created)
    expect(await service.list({ userId: USER_A })).toEqual([created])

    const replaced = await service.replace({
      userId: USER_A,
      projectId: created.id,
      input: input({ name: 'renamed', repo: null, baseBranch: null, additionalRepos: [] }),
    })
    expect(replaced).toMatchObject({
      id: created.id,
      name: 'renamed',
      repo: null,
      additionalRepos: [],
    })
    expect(replaced.updatedAt > created.updatedAt).toBe(true)

    await service.remove({ userId: USER_A, projectId: created.id })
    expect(projectRows).toHaveLength(0)
  })

  it('stores additional repos as plain {repo, branch?} entries without undefined branches', async () => {
    await service.create({ userId: USER_A, input: input() })

    expect(projectRows[0]?.additionalRepos).toStrictEqual([
      { repo: 'octocat/Spoon-Knife', branch: 'test-branch' },
      { repo: 'octocat/docs' },
    ])
  })

  it('lists newest-updated first and only the caller’s own projects', async () => {
    const first = await service.create({ userId: USER_A, input: input({ name: 'first' }) })
    const second = await service.create({
      userId: USER_A,
      input: input({ name: 'second', repo: 'a/b', additionalRepos: [] }),
    })
    await service.create({ userId: USER_B, input: input({ name: 'theirs' }) })

    expect((await service.list({ userId: USER_A })).map((p) => p.id)).toEqual([second.id, first.id])
  })

  it("answers 404 for another user's project on read, replace, remove and workspace", async () => {
    const created = await service.create({ userId: USER_A, input: input() })
    const foreign = { userId: USER_B, projectId: created.id }

    await expect(service.read(foreign)).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.replace({ ...foreign, input: input() })).rejects.toBeInstanceOf(
      NotFoundException,
    )
    await expect(service.remove(foreign)).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.workspace(foreign)).rejects.toBeInstanceOf(NotFoundException)
    expect(projectRows).toHaveLength(1)
    expect(projectRows[0]?.name).toBe('atlas')
  })

  it('answers the workspace with the token brokered from the owner’s github connection', async () => {
    const created = await service.create({ userId: USER_A, input: input() })

    expect(await service.workspace({ userId: USER_A, projectId: created.id })).toEqual({
      projectId: created.id,
      repo: 'dennisofficial/atlas',
      baseBranch: 'main',
      additionalRepos: [
        { repo: 'octocat/Spoon-Knife', branch: 'test-branch' },
        { repo: 'octocat/docs' },
      ],
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
    const row = projectRows[0]
    if (row !== undefined) row.additionalRepos = { not: 'an array' }

    expect((await service.read({ userId: USER_A, projectId: created.id })).additionalRepos).toEqual(
      [],
    )
  })

  it('rejects additional repos without a primary repo', async () => {
    await expect(
      service.create({ userId: USER_A, input: input({ repo: null, baseBranch: null }) }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(projectRows).toHaveLength(0)
  })

  it('rejects duplicate repo names across primary and extras, case-insensitively, on create and replace', async () => {
    const clash = input({ additionalRepos: [{ repo: 'someone/Atlas' }] })
    await expect(service.create({ userId: USER_A, input: clash })).rejects.toBeInstanceOf(
      BadRequestException,
    )

    const created = await service.create({ userId: USER_A, input: input() })
    await expect(
      service.replace({ userId: USER_A, projectId: created.id, input: clash }),
    ).rejects.toBeInstanceOf(BadRequestException)
    const twice = input({ additionalRepos: [{ repo: 'a/x' }, { repo: 'b/X' }] })
    await expect(
      service.replace({ userId: USER_A, projectId: created.id, input: twice }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(projectRows[0]?.additionalRepos).toHaveLength(2)
  })
})
