import { describe, expect, it } from 'bun:test'

import { PERSONAL_HEADER, projectHeader } from '..'
import {
  type FakeNode,
  fakeDaemon,
  file,
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
  })

  it('adds a nested AGENTS.md once a tool touches a directory below the working directory', async () => {
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

    const first = await turn({ ctx: daemon.ctx, options, projectDirectory: '/repo' })
    expect(first).toEqual([`${projectHeader('/repo/AGENTS.md')}\n\nroot rules`])

    await touch({ ctx: daemon.ctx, name: 'read', input: { path: '/repo/packages/x/a.ts' } })
    const second = await step({ ctx: daemon.ctx, options })

    expect(second).toEqual([
      `${projectHeader('/repo/AGENTS.md')}\n\nroot rules`,
      `${projectHeader('/repo/packages/AGENTS.md')}\n\npackage rules`,
      `${projectHeader('/repo/packages/x/AGENTS.md')}\n\nx rules`,
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
    await touch({ ctx: daemon.ctx, name: 'edit', input: { path: '/repo/apps/src/a.ts' } })
    const blocks = await step({ ctx: daemon.ctx, options })

    expect(blocks.filter((block) => block.includes('/repo/apps/AGENTS.md'))).toHaveLength(1)
    expect(blocks).toContain(`${projectHeader('/repo/apps/src/AGENTS.md')}\n\nsrc rules`)
  })

  it('follows a bash workdir into a nested directory', async () => {
    const daemon = fakeDaemon(
      repo({
        '/repo/AGENTS.md': file('root rules'),
        '/repo/infra': { kind: 'dir' },
        '/repo/infra/AGENTS.md': file('infra rules'),
      }),
    )
    const options = personal(null)

    await startTurn({ ctx: daemon.ctx, options, projectDirectory: '/repo' })
    await touch({ ctx: daemon.ctx, name: 'bash', input: { workdir: '/repo/infra' } })
    const blocks = await step({ ctx: daemon.ctx, options })

    expect(blocks).toContain(`${projectHeader('/repo/infra/AGENTS.md')}\n\ninfra rules`)
  })

  it('skips a file that is missing and one over the size cap', async () => {
    const daemon = fakeDaemon(
      repo({
        '/repo/AGENTS.md': file('root rules'),
        '/repo/big': { kind: 'dir' },
        '/repo/big/AGENTS.md': file('x'.repeat(100 * 1024 + 1)),
        '/repo/deep': { kind: 'dir' },
        '/repo/deep/AGENTS.md': file('deep rules'),
        '/repo/bare': { kind: 'dir' },
      }),
    )
    const options = personal(null)

    await startTurn({ ctx: daemon.ctx, options, projectDirectory: '/repo/big' })
    await touch({ ctx: daemon.ctx, name: 'read', input: { path: '/repo/deep/a.ts' } })
    await touch({ ctx: daemon.ctx, name: 'read', input: { path: '/repo/bare/a.ts' } })
    const blocks = await step({ ctx: daemon.ctx, options })

    expect(blocks).toEqual([
      `${projectHeader('/repo/AGENTS.md')}\n\nroot rules`,
      `${projectHeader('/repo/deep/AGENTS.md')}\n\ndeep rules`,
    ])
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
