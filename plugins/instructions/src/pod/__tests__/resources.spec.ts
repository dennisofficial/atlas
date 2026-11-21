import { describe, expect, it } from 'bun:test'

import { PERSONAL_HEADER, projectHeader } from '..'
import { instructionsResource } from '../resources'
import { type FakeNode, fakeDaemon, file, personal, startTurn, step, touch, turn } from './support'

const repo = (extra: Record<string, FakeNode> = {}): Record<string, FakeNode> => ({
  '/repo': { kind: 'dir' },
  '/repo/.git': { kind: 'dir' },
  ...extra,
})

describe('the instructions resource', () => {
  it('loads the repository root, the personal text and every AGENTS.md under it', async () => {
    const daemon = fakeDaemon(
      repo({
        '/repo/AGENTS.md': file('root rules'),
        '/repo/apps': { kind: 'dir' },
        '/repo/apps/AGENTS.md': file('app rules'),
        '/repo/packages': { kind: 'dir' },
        '/repo/packages/AGENTS.md': file('package rules'),
      }),
    )

    const snapshot = await instructionsResource(personal('be brief')).load({
      ctx: daemon.ctx,
      directory: '/repo/apps',
    })

    expect(snapshot.root).toBe('/repo')
    expect(snapshot.directory).toBe('/repo/apps')
    expect(snapshot.personal).toBe('be brief')
    expect(Object.keys(snapshot.files).sort()).toEqual([
      '/repo/AGENTS.md',
      '/repo/apps/AGENTS.md',
      '/repo/packages/AGENTS.md',
    ])
  })

  it('renders the descent from a recorded snapshot with zero daemon calls', async () => {
    const daemon = fakeDaemon(
      repo({
        '/repo/AGENTS.md': file('root rules'),
        '/repo/apps': { kind: 'dir' },
        '/repo/apps/AGENTS.md': file('app rules'),
      }),
    )
    const options = personal('be brief')
    await turn({ ctx: daemon.ctx, options, projectDirectory: '/repo/apps' })
    daemon.calls.length = 0

    const blocks = await step({ ctx: daemon.ctx, options })

    expect(blocks).toEqual([
      `${PERSONAL_HEADER}\n\nbe brief`,
      `${projectHeader('/repo/AGENTS.md')}\n\nroot rules`,
      `${projectHeader('/repo/apps/AGENTS.md')}\n\napp rules`,
    ])
    expect(daemon.calls).toEqual([])
  })

  it('adds a nested file for a directory a tool touched, still with zero daemon calls', async () => {
    const daemon = fakeDaemon(
      repo({
        '/repo/AGENTS.md': file('root rules'),
        '/repo/packages': { kind: 'dir' },
        '/repo/packages/x': { kind: 'dir' },
        '/repo/packages/x/AGENTS.md': file('x rules'),
      }),
    )
    const options = personal(null)
    await startTurn({ ctx: daemon.ctx, options, projectDirectory: '/repo' })
    await touch({ ctx: daemon.ctx, name: 'read', input: { path: '/repo/packages/x/a.ts' } })
    daemon.calls.length = 0

    const blocks = await step({ ctx: daemon.ctx, options })

    expect(blocks).toEqual([
      `${projectHeader('/repo/AGENTS.md')}\n\nroot rules`,
      `${projectHeader('/repo/packages/x/AGENTS.md')}\n\nx rules`,
    ])
    expect(daemon.calls).toEqual([])
  })
})
