import { describe, expect, it } from 'bun:test'

import { ESkillOrigin } from '../../core'
import { discoverRepoSkills } from '../repo-source'
import { fakeDaemon, skillDir } from './support'

describe('discoverRepoSkills', () => {
  it('reads .agents/skills one level deep, folder and flat alike', async () => {
    const { ctx } = fakeDaemon({
      '/repo/.agents/skills': { kind: 'dir' },
      '/repo/.agents/skills/alpha': { kind: 'dir' },
      '/repo/.agents/skills/alpha/skill.md': { kind: 'file', text: skillDir('alpha', 'body') },
      '/repo/.agents/skills/flat.md': { kind: 'file', text: skillDir('flat', 'body') },
      '/repo/.agents/skills/nested': { kind: 'dir' },
      '/repo/.agents/skills/nested/readme.md': { kind: 'file', text: 'no skill here' },
    })

    const found = await discoverRepoSkills({ ctx, projectDirectory: '/repo' })
    expect(found.map((one) => one.name).sort()).toEqual(['alpha', 'flat'])
    expect(found.every((one) => one.origin === ESkillOrigin.Repo)).toBe(true)
    expect(found.find((one) => one.name === 'flat')?.directory).toBe('/repo/.agents/skills')
  })

  it('follows a symlinked skill directory and skips a root that is not there', async () => {
    const { ctx } = fakeDaemon({
      '/repo/.agents/skills': { kind: 'dir' },
      '/repo/.agents/skills/linked': { kind: 'link', target: '/repo/shared/linked-skill' },
      '/repo/shared/linked-skill': { kind: 'dir' },
      '/repo/shared/linked-skill/SKILL.md': {
        kind: 'file',
        text: skillDir('linked', 'body'),
      },
      '/repo/.agents/skills/linked/SKILL.md': { kind: 'file', text: skillDir('linked', 'body') },
    })

    const found = await discoverRepoSkills({ ctx, projectDirectory: '/repo' })
    expect(found.map((one) => one.name)).toEqual(['linked'])
  })

  it('does not read .atlas/skills or .claude/skills, which are not v2 roots', async () => {
    const { ctx, calls } = fakeDaemon({
      '/repo/.atlas/skills': { kind: 'dir' },
      '/repo/.atlas/skills/stale': { kind: 'dir' },
      '/repo/.atlas/skills/stale/SKILL.md': { kind: 'file', text: skillDir('stale', 'body') },
      '/repo/.claude/skills': { kind: 'dir' },
      '/repo/.claude/skills/old': { kind: 'dir' },
      '/repo/.claude/skills/old/SKILL.md': { kind: 'file', text: skillDir('old', 'body') },
    })

    expect(await discoverRepoSkills({ ctx, projectDirectory: '/repo' })).toEqual([])
    expect(
      calls.some(
        (op) =>
          'path' in op &&
          (op.path.startsWith('/repo/.atlas') || op.path.startsWith('/repo/.claude')),
      ),
    ).toBe(false)
  })

  it('keeps a disagreeing name and a bad charset as warnings, never a rejection', async () => {
    const { ctx } = fakeDaemon({
      '/repo/.agents/skills': { kind: 'dir' },
      '/repo/.agents/skills/folder': { kind: 'dir' },
      '/repo/.agents/skills/folder/SKILL.md': {
        kind: 'file',
        text: '---\nname: Other_Name\n---\n\nbody',
      },
    })

    const found = await discoverRepoSkills({ ctx, projectDirectory: '/repo' })
    expect(found).toHaveLength(1)
    expect(found[0]?.name).toBe('other_name')
    expect(found[0]?.warnings.length).toBeGreaterThan(0)
  })
})
