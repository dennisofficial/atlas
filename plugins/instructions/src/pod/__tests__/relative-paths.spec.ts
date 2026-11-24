import { describe, expect, it } from 'bun:test'

import { EContextSlot } from '@dltech/atlas-core'

import { fakeDaemon, file, personal, touch, turn } from './support'

const daemonWithNestedRules = () =>
  fakeDaemon({
    '/repo': { kind: 'dir' },
    '/repo/.git': { kind: 'dir' },
    '/repo/probe': { kind: 'dir' },
    '/repo/probe/AGENTS.md': file('probe rules'),
  })

const nested = {
  type: 'context-loaded' as const,
  slot: EContextSlot.NestedInstructions,
  key: '/repo/probe/AGENTS.md',
  content: 'probe rules',
}

describe('nested instructions for a relative tool path', () => {
  it('records a nested AGENTS.md when a tool reads a path relative to the project directory', async () => {
    const daemon = daemonWithNestedRules()
    await turn({ ctx: daemon.ctx, options: personal(null), projectDirectory: '/repo' })

    expect(await touch({ daemon, name: 'read', input: { path: 'probe/CLAUDE.md' } })).toEqual([
      nested,
    ])
  })

  it('follows a relative bash workdir into a nested directory', async () => {
    const daemon = daemonWithNestedRules()
    await turn({ ctx: daemon.ctx, options: personal(null), projectDirectory: '/repo' })

    expect(await touch({ daemon, name: 'bash', input: { workdir: 'probe' } })).toEqual([nested])
  })
})
