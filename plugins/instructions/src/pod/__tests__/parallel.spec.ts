import { describe, expect, it } from 'bun:test'

import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { MAX_INSTRUCTION_FILES, instructionsResource } from '../resources'
import { MAX_INSTRUCTION_BYTES } from '../sources'
import { type FakeNode, fakeDaemon, file, personal } from './support'

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

const repo = (extra: Record<string, FakeNode> = {}): Record<string, FakeNode> => ({
  '/repo': { kind: 'dir' },
  '/repo/.git': { kind: 'dir' },
  '/repo/apps': { kind: 'dir' },
  '/repo/apps/web': { kind: 'dir' },
  ...extra,
})

describe('the concurrent instructions load', () => {
  it('reads the root walk, the glob and the files in three waves, in glob order', async () => {
    const base = fakeDaemon(
      repo({
        '/repo/AGENTS.md': file('root rules'),
        '/repo/apps/AGENTS.md': file('app rules'),
        '/repo/apps/web/AGENTS.md': file('web rules'),
        '/repo/packages': { kind: 'dir' },
        '/repo/packages/AGENTS.md': file('package rules'),
        '/repo/packages/a': { kind: 'dir' },
        '/repo/packages/a/AGENTS.md': file('a rules'),
        '/repo/packages/b': { kind: 'dir' },
        '/repo/packages/b/AGENTS.md': file('b rules'),
      }),
    )
    const tracked = trackedOf(base.ctx)

    const snapshot = await instructionsResource(personal('be brief')).load({
      ctx: tracked.ctx,
      directory: '/repo/apps/web',
    })

    expect(snapshot.root).toBe('/repo')
    expect(Object.keys(snapshot.files)).toEqual([
      '/repo/AGENTS.md',
      '/repo/apps/AGENTS.md',
      '/repo/apps/web/AGENTS.md',
      '/repo/packages/AGENTS.md',
      '/repo/packages/a/AGENTS.md',
      '/repo/packages/b/AGENTS.md',
    ])
    expect(tracked.waves()).toBe(3)
    expect(tracked.peak()).toBeGreaterThanOrEqual(6)
  })

  it('keeps the size filter and the file cap while reading a bounded batch at once', async () => {
    const nodes: Record<string, FakeNode> = repo()
    nodes['/repo/AGENTS.md'] = file('root rules')
    nodes['/repo/aa'] = { kind: 'dir' }
    nodes['/repo/aa/AGENTS.md'] = file('x'.repeat(MAX_INSTRUCTION_BYTES + 1))
    for (let index = 0; index < 70; index += 1) {
      const name = `d${String(index).padStart(2, '0')}`
      nodes[`/repo/${name}`] = { kind: 'dir' }
      nodes[`/repo/${name}/AGENTS.md`] = file(`${name} rules`)
    }
    const base = fakeDaemon(nodes)
    const tracked = trackedOf(base.ctx)

    const snapshot = await instructionsResource(personal(null)).load({
      ctx: tracked.ctx,
      directory: '/repo/apps',
    })

    const kept = ['/repo/AGENTS.md']
    for (let index = 0; index < MAX_INSTRUCTION_FILES - 1; index += 1)
      kept.push(`/repo/d${String(index).padStart(2, '0')}/AGENTS.md`)

    expect(Object.keys(snapshot.files)).toEqual(kept)
    expect(snapshot.files['/repo/aa/AGENTS.md']).toBeUndefined()
    expect(snapshot.files['/repo/d62/AGENTS.md']).toBe('d62 rules')
    expect(snapshot.files['/repo/d63/AGENTS.md']).toBeUndefined()
    expect(tracked.waves()).toBe(3)
    expect(tracked.peak()).toBeGreaterThan(1)
    expect(tracked.peak()).toBeLessThanOrEqual(16)
  })
})
