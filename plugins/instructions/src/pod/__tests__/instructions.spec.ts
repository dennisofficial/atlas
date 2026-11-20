import { describe, expect, it } from 'bun:test'

import { EContextSlot } from '@dltech/atlas-core'

import { PERSONAL_HEADER, projectHeader } from '..'
import {
  type FakeNode,
  fakeDaemon,
  file,
  nestedKeysOf,
  personal,
  readFiles,
  startTurn,
  step,
  touch,
  turn,
} from './support'

const repo = (extra: Record<string, FakeNode> = {}): Record<string, FakeNode> => ({
  '/repo': { kind: 'dir' },
  '/repo/.git': { kind: 'dir' },
  ...extra,
})

describe('the instructions plugin', () => {
  it('puts the personal block first, then AGENTS.md from the root down to the directory', async () => {
    const daemon = fakeDaemon(
      repo({
        '/repo/AGENTS.md': file('root rules'),
        '/repo/apps': { kind: 'dir' },
        '/repo/apps/AGENTS.md': file('app rules'),
      }),
    )
    const blocks = await turn({
      ctx: daemon.ctx,
      options: personal('be brief'),
      projectDirectory: '/repo/apps',
    })

    expect(blocks).toEqual([
      `${PERSONAL_HEADER}\n\nbe brief`,
      `${projectHeader('/repo/AGENTS.md')}\n\nroot rules`,
      `${projectHeader('/repo/apps/AGENTS.md')}\n\napp rules`,
    ])
  })

  it('ignores files with no personal instructions and directories with no AGENTS.md', async () => {
    const daemon = fakeDaemon(
      repo({ '/repo/AGENTS.md': file('root rules'), '/repo/empty': { kind: 'dir' } }),
    )
    const blocks = await turn({
      ctx: daemon.ctx,
      options: personal(null),
      projectDirectory: '/repo/empty',
    })

    expect(blocks).toEqual([`${projectHeader('/repo/AGENTS.md')}\n\nroot rules`])
  })

  it('stops the descent at the working directory', async () => {
    const daemon = fakeDaemon(
      repo({
        '/repo/AGENTS.md': file('root rules'),
        '/repo/apps': { kind: 'dir' },
        '/repo/packages': { kind: 'dir' },
        '/repo/packages/AGENTS.md': file('package rules'),
      }),
    )
    const blocks = await turn({
      ctx: daemon.ctx,
      options: personal(null),
      projectDirectory: '/repo/apps',
    })

    expect(blocks).toEqual([`${projectHeader('/repo/AGENTS.md')}\n\nroot rules`])
    expect(readFiles(daemon.calls)).not.toContain('/repo/packages/AGENTS.md')
  })

  it('records a nested AGENTS.md as context once a tool touches a directory below the working directory', async () => {
    const daemon = fakeDaemon(
      repo({
        '/repo/AGENTS.md': file('root rules'),
        '/repo/packages': { kind: 'dir' },
        '/repo/packages/AGENTS.md': file('package rules'),
        '/repo/packages/x': { kind: 'dir' },
        '/repo/packages/x/AGENTS.md': file('x rules'),
      }),
    )
    const options = personal(null)

    await turn({ ctx: daemon.ctx, options, projectDirectory: '/repo' })
    const drafts = await touch({ daemon, name: 'read', input: { path: '/repo/packages/x/a.ts' } })

    expect(drafts).toEqual([
      {
        type: 'context-loaded',
        slot: EContextSlot.NestedInstructions,
        key: '/repo/packages/AGENTS.md',
        content: 'package rules',
      },
      {
        type: 'context-loaded',
        slot: EContextSlot.NestedInstructions,
        key: '/repo/packages/x/AGENTS.md',
        content: 'x rules',
      },
    ])
    expect(await touch({ daemon, name: 'read', input: { path: '/repo/packages/x/b.ts' } })).toEqual(
      [],
    )
  })

  it('keeps the system blocks byte-identical across a mid-turn discovery, the next turn and a fresh host', async () => {
    const nodes = repo({
      '/repo/AGENTS.md': file('root rules'),
      '/repo/packages': { kind: 'dir' },
      '/repo/packages/AGENTS.md': file('package rules'),
    })
    const daemon = fakeDaemon(nodes)
    const options = personal('be brief')

    const opening = await turn({ ctx: daemon.ctx, options, projectDirectory: '/repo' })
    await touch({ daemon, name: 'read', input: { path: '/repo/packages/a.ts' } })
    const midTurn = await step({ ctx: daemon.ctx, options })
    const nextTurn = await turn({ ctx: daemon.ctx, options, projectDirectory: '/repo' })

    const fresh = fakeDaemon(nodes)
    fresh.events.push(...daemon.events)
    const resumed = await turn({ ctx: fresh.ctx, options, projectDirectory: '/repo' })
    const again = await touch({
      daemon: fresh,
      name: 'read',
      input: { path: '/repo/packages/b.ts' },
    })

    expect(midTurn).toEqual(opening)
    expect(nextTurn).toEqual(opening)
    expect(resumed).toEqual(opening)
    expect(again).toEqual([])
  })

  it('records a nested file again only when its content changed', async () => {
    const daemon = fakeDaemon(
      repo({ '/repo/infra': { kind: 'dir' }, '/repo/infra/AGENTS.md': file('first edition') }),
    )
    const options = personal(null)

    await startTurn({ ctx: daemon.ctx, options, projectDirectory: '/repo' })
    await touch({ daemon, name: 'bash', input: { workdir: '/repo/infra' } })
    const node = daemon.nodes['/repo/infra/AGENTS.md']
    if (node?.kind === 'file') node.text = 'second edition'
    await startTurn({ ctx: daemon.ctx, options, projectDirectory: '/repo' })
    const drafts = await touch({ daemon, name: 'bash', input: { workdir: '/repo/infra' } })

    expect(drafts.map((draft) => (draft.type === 'context-loaded' ? draft.content : ''))).toEqual([
      'second edition',
    ])
  })

  it('does not repeat a nested file the root-to-directory descent already carries', async () => {
    const daemon = fakeDaemon(
      repo({
        '/repo/AGENTS.md': file('root rules'),
        '/repo/apps': { kind: 'dir' },
        '/repo/apps/AGENTS.md': file('app rules'),
        '/repo/apps/src': { kind: 'dir' },
        '/repo/apps/src/AGENTS.md': file('src rules'),
      }),
    )
    const options = personal(null)

    await startTurn({ ctx: daemon.ctx, options, projectDirectory: '/repo/apps' })
    const drafts = await touch({ daemon, name: 'edit', input: { path: '/repo/apps/src/a.ts' } })
    const blocks = await step({ ctx: daemon.ctx, options })

    expect(nestedKeysOf(drafts)).toEqual(['/repo/apps/src/AGENTS.md'])
    expect(blocks.filter((block) => block.includes('/repo/apps/AGENTS.md'))).toHaveLength(1)
  })

  it('follows a bash workdir into a nested directory', async () => {
    const daemon = fakeDaemon(
      repo({
        '/repo/AGENTS.md': file('root rules'),
        '/repo/infra': { kind: 'dir' },
        '/repo/infra/AGENTS.md': file('infra rules'),
      }),
    )

    await startTurn({ ctx: daemon.ctx, options: personal(null), projectDirectory: '/repo' })
    const drafts = await touch({ daemon, name: 'bash', input: { workdir: '/repo/infra' } })

    expect(nestedKeysOf(drafts)).toEqual(['/repo/infra/AGENTS.md'])
  })

  it('skips a file that is missing and one over the size cap', async () => {
    const daemon = fakeDaemon(
      repo({
        '/repo/AGENTS.md': file('root rules'),
        '/repo/big': { kind: 'dir' },
        '/repo/big/AGENTS.md': file('large rules', 100 * 1024 + 1),
        '/repo/deep': { kind: 'dir' },
        '/repo/deep/AGENTS.md': file('deep rules'),
        '/repo/bare': { kind: 'dir' },
      }),
    )
    const options = personal(null)

    await startTurn({ ctx: daemon.ctx, options, projectDirectory: '/repo' })
    const deep = await touch({ daemon, name: 'read', input: { path: '/repo/deep/a.ts' } })
    const bare = await touch({ daemon, name: 'read', input: { path: '/repo/bare/a.ts' } })
    const big = await touch({ daemon, name: 'read', input: { path: '/repo/big/a.ts' } })
    const blocks = await step({ ctx: daemon.ctx, options })

    expect(nestedKeysOf([...deep, ...bare, ...big])).toEqual(['/repo/deep/AGENTS.md'])
    expect(blocks).toEqual([`${projectHeader('/repo/AGENTS.md')}\n\nroot rules`])
    expect(readFiles(daemon.calls)).not.toContain('/repo/big/AGENTS.md')
  })

  it('reads no CLAUDE.md or ATLAS.md, whatever a repository holds', async () => {
    const daemon = fakeDaemon(
      repo({
        '/repo/CLAUDE.md': file('claude rules'),
        '/repo/ATLAS.md': file('atlas rules'),
        '/repo/.atlas': { kind: 'dir' },
        '/repo/.atlas/ATLAS.md': file('atlas local rules'),
      }),
    )
    const blocks = await turn({
      ctx: daemon.ctx,
      options: personal(null),
      projectDirectory: '/repo',
    })

    expect(blocks).toEqual([])
    expect(readFiles(daemon.calls)).toEqual([])
  })

  it('uses the working directory alone when no .git marks a repository', async () => {
    const daemon = fakeDaemon({
      '/solo': { kind: 'dir' },
      '/solo/AGENTS.md': file('solo rules'),
    })
    const blocks = await turn({
      ctx: daemon.ctx,
      options: personal(null),
      projectDirectory: '/solo',
    })

    expect(blocks).toEqual([`${projectHeader('/solo/AGENTS.md')}\n\nsolo rules`])
  })

  it('re-reads the files on the next turn and caches them within one', async () => {
    const daemon = fakeDaemon(repo({ '/repo/AGENTS.md': file('first edition') }))
    let reads = 0
    const options = {
      personal: async () => {
        reads += 1
        return 'be brief'
      },
    }

    await turn({ ctx: daemon.ctx, options, projectDirectory: '/repo' })
    expect(await step({ ctx: daemon.ctx, options })).toContain(
      `${projectHeader('/repo/AGENTS.md')}\n\nfirst edition`,
    )

    const node = daemon.nodes['/repo/AGENTS.md']
    if (node?.kind === 'file') node.text = 'second edition'
    const next = await turn({ ctx: daemon.ctx, options, projectDirectory: '/repo' })

    expect(next).toContain(`${projectHeader('/repo/AGENTS.md')}\n\nsecond edition`)
    expect(reads).toBe(2)
    expect(readFiles(daemon.calls).filter((path) => path === '/repo/AGENTS.md')).toHaveLength(2)
  })

  it('keeps the project files when the personal instructions fail', async () => {
    const daemon = fakeDaemon(repo({ '/repo/AGENTS.md': file('root rules') }))
    const blocks = await turn({
      ctx: daemon.ctx,
      options: {
        personal: async () => {
          throw new Error('cloud is down')
        },
      },
      projectDirectory: '/repo',
    })

    expect(blocks).toEqual([`${projectHeader('/repo/AGENTS.md')}\n\nroot rules`])
  })
})
