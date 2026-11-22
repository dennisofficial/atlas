import { describe, expect, it } from 'bun:test'

import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { discoverRepoSkills } from '../repo-source'
import { type FakeNode, fakeDaemon, skillDir } from './support'

const trackedOf = (ctx: PluginPodContext) => {
  let inFlight = 0
  let peak = 0
  let waves = 0

  const call: PluginPodContext['call'] = async (op, options) => {
    inFlight += 1
    peak = Math.max(peak, inFlight)
    if (inFlight === 1) waves += 1
    try {
      await new Promise((resolve) => setTimeout(resolve, 1))
      return await ctx.call(op, options)
    } finally {
      inFlight -= 1
    }
  }

  return { ctx: { ...ctx, call }, peak: () => peak, waves: () => waves }
}

const nodes = (): Record<string, FakeNode> => ({
  '/repo/.agents/skills': { kind: 'dir' },
  '/repo/.agents/skills/zeta': { kind: 'dir' },
  '/repo/.agents/skills/zeta/skill.md': { kind: 'file', text: skillDir('zeta', 'body') },
  '/repo/.agents/skills/alpha': { kind: 'dir' },
  '/repo/.agents/skills/alpha/SKILL.md': { kind: 'file', text: skillDir('alpha', 'body') },
  '/repo/.agents/skills/flat.md': { kind: 'file', text: skillDir('flat', 'body') },
  '/repo/.agents/skills/notes': { kind: 'dir' },
  '/repo/.agents/skills/notes/readme.md': { kind: 'file', text: 'no skill here' },
  '/repo/.agents/skills/beta': { kind: 'dir' },
  '/repo/.agents/skills/beta/SKILL.md': { kind: 'file', text: skillDir('beta', 'body') },
})

describe('the concurrent repo skills load', () => {
  it('reads every entry in three waves and keeps the directory order', async () => {
    const base = fakeDaemon(nodes())
    const tracked = trackedOf(base.ctx)

    const found = await discoverRepoSkills({ ctx: tracked.ctx, projectDirectory: '/repo' })

    expect(found.map((one) => one.name)).toEqual(['zeta', 'alpha', 'flat', 'beta'])
    expect(tracked.waves()).toBeLessThanOrEqual(3)
    expect(tracked.peak()).toBeGreaterThanOrEqual(4)
  })
})
