import { describe, expect, it } from 'bun:test'

import { EContextSlot } from '@dltech/atlas-core'

import { skillsSlashOf } from '../slash'
import { fakeCloud, fakeDaemon, invoke, skillDir, textOf } from './support'

const repoTree = () => ({
  '/repo/.agents/skills': { kind: 'dir' as const },
  '/repo/.agents/skills/alpha': { kind: 'dir' as const },
  '/repo/.agents/skills/alpha/SKILL.md': {
    kind: 'file' as const,
    text: skillDir('alpha', 'run $1 with $ARGUMENTS'),
  },
  '/repo/.agents/skills/hidden': { kind: 'dir' as const },
  '/repo/.agents/skills/hidden/SKILL.md': {
    kind: 'file' as const,
    text: skillDir('hidden', 'hidden body', 'disable-model-invocation: true\n'),
  },
})

const slashOf = () => {
  const { ctx } = fakeDaemon(repoTree())
  const cloud = fakeCloud({ entries: [] })
  return {
    ctx,
    cloud,
    slash: skillsSlashOf({ ctx, options: { cloud: () => cloud }, directory: '/repo' }),
  }
}

describe('the skills slash source', () => {
  it('lists the catalogue names, including a skill only the operator may load', async () => {
    const { slash } = slashOf()
    const names = await slash.names()
    expect(names).toContain('alpha')
    expect(names).toContain('hidden')
    expect(names).toContain('commit')
  })

  it('loads a skill into one context-loaded draft with the arguments expanded', async () => {
    const { slash } = slashOf()
    const loaded = await slash.load({ name: 'alpha', argumentText: 'one two' })
    expect(loaded).toEqual({
      ok: true,
      drafts: [
        {
          type: 'context-loaded',
          slot: EContextSlot.Skill,
          key: 'alpha',
          content: expect.stringContaining('run one with one two'),
        },
      ],
    })
  })

  it('loads a skill the model may not invoke', async () => {
    const { slash } = slashOf()
    const loaded = await slash.load({ name: 'hidden', argumentText: '' })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(loaded.drafts[0]).toMatchObject({ type: 'context-loaded', key: 'hidden' })
  })

  it('refuses an unknown name with the sentence the tool uses', async () => {
    const { ctx, cloud, slash } = slashOf()
    const refused = await slash.load({ name: 'nope', argumentText: '' })
    const tool = await invoke({ ctx, cloud, name: 'skill', input: { name: 'nope' } })
    expect(refused).toEqual({ ok: false, reason: textOf(tool) })
  })
})
