import { describe, expect, it } from 'bun:test'

import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { ESkillOrigin } from '../../core'
import { type FakeNode, fakeCloud, fakeDaemon, turn } from './support'

const ROOTS = ['/repo/.atlas/skills', '/repo/.agents/skills']

const emptyRepo = (): Record<string, FakeNode> => ({
  '/repo': { kind: 'dir' },
  '/repo/.atlas': { kind: 'dir' },
  '/repo/.atlas/skills': { kind: 'dir' },
  '/repo/.agents': { kind: 'dir' },
  '/repo/.agents/skills': { kind: 'dir' },
})

type Nodes = Record<string, FakeNode>

const rig = (nodes: Nodes) => {
  const daemon = fakeDaemon(nodes)
  const appended: unknown[] = []
  const ctx: PluginPodContext = {
    ...daemon.ctx,
    append: async (drafts) => void appended.push(...drafts),
  }
  const cloud = fakeCloud({ entries: [] })
  return { daemon, ctx, cloud, appended, nodes }
}

const settle = async (ready: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('the skill index never settled after a watch event')
}

type Row = { name: string; description: string; argumentHint: string | null; origin: ESkillOrigin }

const rowsOf = (draft: unknown): readonly Row[] => (draft as { skills: readonly Row[] }).skills

const repoRowsOf = (draft: unknown): readonly Row[] =>
  rowsOf(draft).filter((row) => row.origin === ESkillOrigin.Repo)

const watchStarts = (calls: readonly { op: string }[]): number =>
  calls.filter((call) => call.op === 'watch.start').length

const addSkill = (args: {
  nodes: Nodes
  root: string
  name: string
  description: string
}): void => {
  args.nodes[`${args.root}/${args.name}`] = { kind: 'dir' }
  args.nodes[`${args.root}/${args.name}/SKILL.md`] = {
    kind: 'file',
    text: `---\nname: ${args.name}\ndescription: ${args.description}\n---\n\nbody\n`,
  }
}

describe('the watched skill index', () => {
  it('watches both repo roots from the first turn and publishes the list', async () => {
    const { daemon, ctx, cloud, appended } = rig(emptyRepo())
    await turn({ ctx, cloud })
    expect(daemon.calls.filter((call) => call.op === 'watch.start')).toEqual([
      { op: 'watch.start', watchId: 'skills:s1', roots: ROOTS },
    ])
    expect(appended).toHaveLength(1)
    expect(repoRowsOf(appended[0])).toEqual([])
  })

  it('adds a skill the watcher reports, in one frame', async () => {
    const { daemon, ctx, cloud, appended, nodes } = rig(emptyRepo())
    await turn({ ctx, cloud })
    addSkill({ nodes, root: '/repo/.atlas/skills', name: 'alpha', description: 'does alpha' })
    daemon.emit({
      type: 'watch.changed',
      watchId: 'skills:s1',
      paths: ['/repo/.atlas/skills/alpha/SKILL.md'],
    })
    await settle(() => appended.length === 2)
    expect(appended).toHaveLength(2)
    expect(repoRowsOf(appended[1])).toEqual([
      { name: 'alpha', description: 'does alpha', argumentHint: null, origin: ESkillOrigin.Repo },
    ])
    const blocks = await turn({ ctx, cloud })
    expect(blocks.join('\n')).toContain('alpha: does alpha')
    expect(watchStarts(daemon.calls)).toBe(1)
  })

  it('reflects an edited SKILL.md in the next listing', async () => {
    const { daemon, ctx, cloud, appended, nodes } = rig(emptyRepo())
    addSkill({ nodes, root: '/repo/.agents/skills', name: 'beta', description: 'does beta' })
    await turn({ ctx, cloud })
    addSkill({ nodes, root: '/repo/.agents/skills', name: 'beta', description: 'does beta better' })
    daemon.emit({
      type: 'watch.changed',
      watchId: 'skills:s1',
      paths: ['/repo/.agents/skills/beta/SKILL.md'],
    })
    await settle(() => appended.length === 2)
    expect(repoRowsOf(appended[1])[0]?.description).toBe('does beta better')
    const blocks = await turn({ ctx, cloud })
    expect(blocks.join('\n')).toContain('does beta better')
    expect(blocks.join('\n')).not.toContain('beta: does beta\n')
  })

  it('drops a skill whose directory leaves a watched root', async () => {
    const { daemon, ctx, cloud, appended, nodes } = rig(emptyRepo())
    addSkill({ nodes, root: '/repo/.atlas/skills', name: 'alpha', description: 'does alpha' })
    await turn({ ctx, cloud })
    delete nodes['/repo/.atlas/skills/alpha/SKILL.md']
    delete nodes['/repo/.atlas/skills/alpha']
    daemon.emit({
      type: 'watch.changed',
      watchId: 'skills:s1',
      paths: ['/repo/.atlas/skills/alpha'],
    })
    await settle(() => appended.length === 2)
    expect(repoRowsOf(appended[1])).toEqual([])
    const blocks = await turn({ ctx, cloud })
    expect(blocks.join('\n')).not.toContain('alpha')
  })

  it('ignores a change reported for another watcher', async () => {
    const { daemon, ctx, cloud, appended, nodes } = rig(emptyRepo())
    await turn({ ctx, cloud })
    addSkill({ nodes, root: '/repo/.atlas/skills', name: 'alpha', description: 'does alpha' })
    daemon.emit({ type: 'watch.changed', watchId: 'another:watch', paths: ['/repo/x'] })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(appended).toHaveLength(1)
  })

  it('keeps a repo skill ahead of a cloud skill of the same name', async () => {
    const { daemon, ctx, cloud, appended, nodes } = rig(emptyRepo())
    addSkill({ nodes, root: '/repo/.atlas/skills', name: 'shared', description: 'from the repo' })
    await turn({ ctx, cloud })
    daemon.emit({ type: 'watch.changed', watchId: 'skills:s1', paths: ['/repo/.atlas/skills'] })
    await settle(() => appended.length === 2)
    const shared = rowsOf(appended[1]).filter((row) => row.name === 'shared')
    expect(shared).toEqual([
      {
        name: 'shared',
        description: 'from the repo',
        argumentHint: null,
        origin: ESkillOrigin.Repo,
      },
    ])
  })
})
