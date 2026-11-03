import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { ERepoTreeEntryKind, ESkillCatalogueOrigin } from '@dltech/atlas-wire'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { db } from '@dltech/atlas-db'
import type { GithubRepoReads } from '../github/github-repo-reads'
import type { ProjectsService } from '../projects/projects.service'
import { SkillCatalogueService } from './skill-catalogue.service'

const USER = 'user-a'
const skillText = (args: { name: string; description: string; extra?: string }) =>
  `---\nname: ${args.name}\ndescription: ${args.description}\n${args.extra ?? ''}---\nbody\n`

describe('SkillCatalogueService', () => {
  const database = useTestDatabase()
  let blobs: Record<string, string>
  let treeSha: string
  let workspace: { repo: string | null; baseBranch: string | null; githubToken: string | null }
  let reads: { listTreeSnapshot: ReturnType<typeof vi.fn>; readBlob: ReturnType<typeof vi.fn> }
  let service: SkillCatalogueService

  const put = async (args: { name: string; text: string }) => {
    const skill = await db.orm.public.Skill.create({ userId: USER, name: args.name })
    const bytes = new TextEncoder().encode(args.text)
    await db.orm.public.SkillFile.create({
      skillId: skill.id,
      path: 'SKILL.md',
      revision: 1,
      contentHash: '',
      content: bytes,
      isText: true,
      size: bytes.byteLength,
    })
  }

  beforeEach(async () => {
    await seedUser({ db: database().db, id: USER })
    blobs = {
      s1: skillText({ name: 'deploy', description: 'repo deploy' }),
      s2: skillText({ name: 'commit', description: 'repo commit' }),
    }
    treeSha = 'tree-1'
    workspace = { repo: 'o/r', baseBranch: 'main', githubToken: 'tok' }
    reads = {
      listTreeSnapshot: vi.fn(async () => ({
        sha: treeSha,
        truncated: false,
        entries: [
          { path: '.claude/skills/deploy/SKILL.md', kind: ERepoTreeEntryKind.File, sha: 's1' },
          { path: '.atlas/skills/commit/SKILL.md', kind: ERepoTreeEntryKind.File, sha: 's2' },
          { path: 'docs/readme.md', kind: ERepoTreeEntryKind.File, sha: 's3' },
        ],
      })),
      readBlob: vi.fn(async (args: { sha: string }) => blobs[args.sha] ?? ''),
    }
    const projects = { workspace: vi.fn(async () => workspace) }
    service = new SkillCatalogueService(
      projects as unknown as ProjectsService,
      reads as unknown as GithubRepoReads,
    )
  })

  it('lists built-ins with a builtin origin', async () => {
    const skills = await service.list({ userId: USER })
    expect(skills.find((skill) => skill.name === 'commit')).toMatchObject({
      origin: ESkillCatalogueOrigin.BuiltIn,
    })
  })

  it('lists user skills from the Skill tables, skipping invalid and non-invocable ones', async () => {
    await put({ name: 'mine', text: skillText({ name: 'mine', description: 'm' }) })
    await put({ name: 'empty', text: '' })
    await put({
      name: 'hidden',
      text: skillText({ name: 'hidden', description: 'h', extra: 'user-invocable: false\n' }),
    })

    const names = (await service.list({ userId: USER })).map((skill) => skill.name)
    expect(names).toContain('mine')
    for (const absent of ['empty', 'hidden']) expect(names).not.toContain(absent)
  })

  it('lets a user skill override a built-in and a project skill override both', async () => {
    await put({ name: 'commit', text: skillText({ name: 'commit', description: 'user' }) })
    const withUser = await service.list({ userId: USER })
    expect(withUser.filter((skill) => skill.name === 'commit')).toEqual([
      { name: 'commit', summary: 'user', origin: ESkillCatalogueOrigin.User },
    ])

    const withProject = await service.list({ userId: USER, projectId: 'p' })
    expect(withProject.filter((skill) => skill.name === 'commit')).toEqual([
      { name: 'commit', summary: 'repo commit', origin: ESkillCatalogueOrigin.Project },
    ])
    expect(withProject.find((skill) => skill.name === 'deploy')).toMatchObject({
      origin: ESkillCatalogueOrigin.Project,
    })
  })

  it('caches repo skills by tree sha', async () => {
    await service.list({ userId: USER, projectId: 'p' })
    await service.list({ userId: USER, projectId: 'p' })
    expect(reads.listTreeSnapshot).toHaveBeenCalledTimes(2)
    expect(reads.readBlob).toHaveBeenCalledTimes(2)

    treeSha = 'tree-2'
    await service.list({ userId: USER, projectId: 'p' })
    expect(reads.readBlob).toHaveBeenCalledTimes(4)
  })

  it('degrades to built-in and user skills when github fails or has no token', async () => {
    reads.listTreeSnapshot.mockRejectedValueOnce(new Error('boom'))
    const failed = await service.list({ userId: USER, projectId: 'p' })
    expect(failed.some((skill) => skill.origin === ESkillCatalogueOrigin.Project)).toBe(false)
    expect(failed.length).toBeGreaterThan(0)

    workspace.githubToken = null
    const tokenless = await service.list({ userId: USER, projectId: 'p' })
    expect(tokenless.some((skill) => skill.origin === ESkillCatalogueOrigin.Project)).toBe(false)
  })
})
