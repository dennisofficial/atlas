import { describe, expect, it } from 'bun:test'

import { ESkillOrigin } from '../../core'
import { skillsResource } from '../resources'
import { fakeCloud, fakeDaemon, invoke, skillDir, step, turn } from './support'

const repoTree = () => ({
  '/repo': { kind: 'dir' as const },
  '/repo/.git': { kind: 'dir' as const },
  '/repo/.agents': { kind: 'dir' as const },
  '/repo/.agents/skills': { kind: 'dir' as const },
  '/repo/.agents/skills/alpha': { kind: 'dir' as const },
  '/repo/.agents/skills/alpha/SKILL.md': { kind: 'file' as const, text: skillDir('alpha', 'body') },
})

describe('the skills resource', () => {
  it('loads the catalogue and keeps a built-in skill in the snapshot by name alone', async () => {
    const { ctx } = fakeDaemon(repoTree())
    const snapshot = await skillsResource({ cloud: () => fakeCloud({ entries: [] }) }).load({
      ctx,
      directory: '/repo',
    })

    expect(snapshot.directory).toBe('/repo')
    expect(snapshot.skills.find((skill) => skill.name === 'alpha')).toMatchObject({
      origin: ESkillOrigin.Repo,
      entryPath: '/repo/.agents/skills/alpha/SKILL.md',
    })
    expect(snapshot.skills.find((skill) => skill.name === 'atlas')).toEqual({
      name: 'atlas',
      origin: ESkillOrigin.BuiltIn,
    })
    expect(JSON.stringify(snapshot).length).toBeLessThan(20_000)
  })

  it('announces skills-changed from the snapshot it recorded', async () => {
    const { ctx } = fakeDaemon(repoTree())
    const resource = skillsResource({ cloud: () => fakeCloud({ entries: [] }) })
    const value = await resource.load({ ctx, directory: '/repo' })
    const announced = resource.announce?.(value, ctx) ?? []

    expect(announced[0]).toMatchObject({ type: 'skills-changed' })
    expect(JSON.stringify(announced[0])).toContain('"name":"alpha"')
  })

  it('renders the listing from a recorded snapshot with zero daemon calls', async () => {
    const daemon = fakeDaemon(repoTree())
    const cloud = fakeCloud({ entries: [] })
    await turn({ ctx: daemon.ctx, cloud })
    daemon.calls.length = 0

    const blocks = await step({ ctx: daemon.ctx, cloud })

    expect(blocks.join('\n')).toContain('- alpha: does alpha')
    expect(daemon.calls).toEqual([])
  })

  it('reloads the resource after a write, so the next read sees the new skill', async () => {
    const daemon = fakeDaemon(repoTree())
    const cloud = fakeCloud({ entries: [] })
    await turn({ ctx: daemon.ctx, cloud })

    const outcome = await invoke({
      ctx: daemon.ctx,
      cloud,
      name: 'skill_manage',
      input: { action: 'install', layer: 'repo', name: 'beta', body: skillDir('beta', 'body') },
    })
    expect(outcome.ok).toBe(true)

    const snapshots = daemon.events.filter((event) => event.type === 'resource-loaded')
    expect(JSON.stringify(snapshots.at(-1))).toContain('"name":"beta"')
  })
})
