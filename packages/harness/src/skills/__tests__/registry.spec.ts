import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'bun:test'

import { EmbeddedSkillSource } from '../embedded-source'
import { FilesystemSkillSource } from '../filesystem-source'
import { loadSkills, readSkillSources } from '../registry'
import { ESkillOrigin } from '../skill'

let home: string
let repository: string

const write = ({ root, at, content }: { root: string; at: string; content: string }): void => {
  const path = join(root, at)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

const userSource = () =>
  new FilesystemSkillSource({ directory: home, origin: ESkillOrigin.User })

const projectSource = () =>
  new FilesystemSkillSource({ directory: repository, origin: ESkillOrigin.Project })

const builtInNames = async (): Promise<readonly string[]> =>
  (await new EmbeddedSkillSource().load()).map((skill) => skill.spec.name)

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'atlas-user-skills-'))
  repository = mkdtempSync(join(tmpdir(), 'atlas-project-skills-'))
})

describe('loadSkills', () => {
  it('merges every source when no name collides', async () => {
    write({ root: home, at: 'plan.md', content: 'user plan' })
    write({ root: repository, at: 'review.md', content: 'project review' })

    const loaded = await loadSkills({
      sources: [new EmbeddedSkillSource(), userSource(), projectSource()],
    })

    expect(loaded.map((skill) => skill.spec.name)).toEqual(
      [...(await builtInNames()), 'plan', 'review'].sort(),
    )
  })

  it('lets the user shadow a built-in', async () => {
    write({ root: home, at: 'commit.md', content: 'user commit' })

    const loaded = await loadSkills({ sources: [new EmbeddedSkillSource(), userSource()] })

    expect(loaded).toHaveLength((await builtInNames()).length)

    const commit = loaded.find((skill) => skill.spec.name === 'commit')
    expect(commit?.origin).toBe(ESkillOrigin.User)
    expect(commit?.body).toBe('user commit')
  })

  it('lets the project shadow both the user and the built-in', async () => {
    write({ root: home, at: 'commit.md', content: 'user commit' })
    write({ root: repository, at: 'commit.md', content: 'project commit' })

    const loaded = await loadSkills({
      sources: [new EmbeddedSkillSource(), userSource(), projectSource()],
    })

    expect(loaded).toHaveLength((await builtInNames()).length)

    const commit = loaded.find((skill) => skill.spec.name === 'commit')
    expect(commit?.origin).toBe(ESkillOrigin.Project)
    expect(commit?.body).toBe('project commit')
  })

  it('applies precedence regardless of the order the sources are passed in', async () => {
    write({ root: home, at: 'commit.md', content: 'user commit' })
    write({ root: repository, at: 'commit.md', content: 'project commit' })

    const loaded = await loadSkills({
      sources: [projectSource(), new EmbeddedSkillSource(), userSource()],
    })

    const commit = loaded.find((skill) => skill.spec.name === 'commit')
    expect(commit?.origin).toBe(ESkillOrigin.Project)
    expect(commit?.body).toBe('project commit')
  })

  it('sorts by name so two runs agree', async () => {
    write({ root: repository, at: 'zeta.md', content: 'z' })
    write({ root: repository, at: 'alpha/SKILL.md', content: 'a' })
    write({ root: repository, at: 'mid.md', content: 'm' })

    const loaded = await loadSkills({ sources: [projectSource(), new EmbeddedSkillSource()] })

    expect(loaded.map((skill) => skill.spec.name)).toEqual(
      [...(await builtInNames()), 'alpha', 'mid', 'zeta'].sort(),
    )
  })

  it('yields nothing when no source has anything to offer', async () => {
    expect(await loadSkills({ sources: [] })).toEqual([])
  })
})

describe('readSkillSources', () => {
  it('reports the skills a higher-precedence source shadowed', async () => {
    write({ root: home, at: 'commit.md', content: 'user commit' })
    write({ root: repository, at: 'commit.md', content: 'project commit' })

    const load = await readSkillSources({
      sources: [new EmbeddedSkillSource(), userSource(), projectSource()],
    })

    expect(load.skills.find((skill) => skill.spec.name === 'commit')?.body).toBe('project commit')
    expect(load.shadowed.map((skill) => skill.origin).sort()).toEqual([
      ESkillOrigin.BuiltIn,
      ESkillOrigin.User,
    ])
  })

  it('reports nothing shadowed when no name collides', async () => {
    write({ root: repository, at: 'review.md', content: 'project review' })

    const load = await readSkillSources({
      sources: [new EmbeddedSkillSource(), projectSource()],
    })

    expect(load.shadowed).toEqual([])
  })
})
