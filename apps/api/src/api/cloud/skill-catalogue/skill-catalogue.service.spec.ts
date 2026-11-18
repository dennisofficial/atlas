import { db } from '@dltech/atlas-db'
import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { ESkillCatalogueOrigin, skillCatalogueRequestSchema } from '@dltech/atlas-wire'
import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { GithubRepoReads } from '../github/github-repo-reads'
import { SkillCatalogueService } from './skill-catalogue.service'

const USER = 'user-a'
const skillText = (args: { name: string; description: string; extra?: string }) =>
  `---\nname: ${args.name}\ndescription: ${args.description}\n${args.extra ?? ''}---\nbody\n`

describe('SkillCatalogueService', () => {
  const database = useTestDatabase()
  const service = new SkillCatalogueService()

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

    const skills = await service.list({ userId: USER })
    expect(skills.find((skill) => skill.name === 'mine')).toMatchObject({
      summary: 'm',
      origin: ESkillCatalogueOrigin.User,
    })
    const names = skills.map((skill) => skill.name)
    for (const absent of ['empty', 'hidden']) expect(names).not.toContain(absent)
  })

  it('lets a user skill override a built-in', async () => {
    await put({ name: 'commit', text: skillText({ name: 'commit', description: 'user' }) })

    expect(
      (await service.list({ userId: USER })).filter((skill) => skill.name === 'commit'),
    ).toEqual([{ name: 'commit', summary: 'user', origin: ESkillCatalogueOrigin.User }])
  })

  it('reads no repository, and its request cannot name a project', async () => {
    const tree = vi.spyOn(GithubRepoReads.prototype, 'listTreeSnapshot')
    const blob = vi.spyOn(GithubRepoReads.prototype, 'readBlob')

    await service.list({ userId: USER })
    await service.list({ userId: USER })

    expect(tree).not.toHaveBeenCalled()
    expect(blob).not.toHaveBeenCalled()
    expect(skillCatalogueRequestSchema.safeParse({ projectId: 'p' }).success).toBe(false)
    tree.mockRestore()
    blob.mockRestore()
  })
})
