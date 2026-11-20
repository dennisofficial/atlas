import { describe, expect, it } from 'bun:test'

import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import type { CallOp, CallResult } from '@dltech/atlas-protocol'

import { dirs, file, rig, turn, type FakeNode } from './repo-agent-rig'

const docsWriter = [
  '---',
  'description: Writes the docs a change needs.',
  '---',
  '',
  'Write.',
].join('\n')

const oldWriter = ['---', 'description: Writes for the old repository.', '---', '', 'Write.'].join(
  '\n',
)

const pause = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

const gate = (prefix: string) => {
  let waiting: Promise<void> | null = null
  let release: () => void = () => undefined
  return {
    close: (): void => {
      waiting = new Promise<void>((settle) => {
        release = settle
      })
    },
    open: (): void => {
      release()
      waiting = null
    },
    hold: async (op: CallOp): Promise<void> => {
      const held = waiting
      if (held === null) return
      if (!('path' in op) || !op.path.startsWith(prefix)) return
      await held
    },
  }
}

const gatedRig = (nodes: Record<string, FakeNode>, prefix: string) => {
  const base = rig({ nodes })
  const held = gate(prefix)
  const ctx: PluginPodContext = {
    ...base.ctx,
    call: async (op: CallOp): Promise<CallResult> => {
      await held.hold(op)
      return await base.ctx.call(op)
    },
  }
  return { ctx, calls: base.calls, emit: base.emit, held }
}

const watchStarts = (calls: readonly { op: string }[]): number =>
  calls.filter((call) => call.op === 'watch.start').length

const switchedRepo = (): Record<string, FakeNode> => ({
  ...dirs(
    '/old',
    '/old/.agents',
    '/old/.agents/agents',
    '/new',
    '/new/.agents',
    '/new/.agents/agents',
  ),
  ...Object.fromEntries([
    file('/old/.agents/agents/old-writer.md', oldWriter),
    file('/new/.agents/agents/docs-writer.md', docsWriter),
  ]),
})

describe('a project directory switch mid-read', () => {
  it('drops a read of the old directory that lands after the new one', async () => {
    const nodes = switchedRepo()
    const { ctx, emit, held } = gatedRig(nodes, '/old')

    expect((await turn({ ctx, projectDirectory: '/old' })).join('\n')).toContain('old-writer')

    held.close()
    emit({
      type: 'watch.changed',
      watchId: 'crew:s1',
      paths: ['/old/.agents/agents/old-writer.md'],
    })
    await pause(10)

    const switched = await turn({ ctx, projectDirectory: '/new' })
    expect(switched.join('\n')).toContain('- docs-writer: Writes the docs a change needs.')
    expect(switched.join('\n')).not.toContain('old-writer')

    held.open()
    await pause(20)

    const after = await turn({ ctx, projectDirectory: '/new' })
    expect(after.join('\n')).toContain('- docs-writer: Writes the docs a change needs.')
    expect(after.join('\n')).not.toContain('old-writer')
  })
})

describe('a repository with no agent directory yet', () => {
  it('re-arms the watch once the directory appears, then takes the cached fast path', async () => {
    const nodes: Record<string, FakeNode> = dirs('/work', '/work/.agents')
    const { ctx, calls } = gatedRig(nodes, '/nowhere')

    expect((await turn({ ctx, projectDirectory: '/work' })).join('\n')).not.toContain('docs-writer')
    expect(watchStarts(calls)).toBe(1)

    nodes['/work/.agents/agents'] = { kind: 'dir' }
    nodes['/work/.agents/agents/docs-writer.md'] = { kind: 'file', text: docsWriter }

    const armed = await turn({ ctx, projectDirectory: '/work' })
    expect(armed.join('\n')).toContain('- docs-writer: Writes the docs a change needs.')
    expect(watchStarts(calls)).toBe(2)

    const settled = calls.length
    await turn({ ctx, projectDirectory: '/work' })
    expect(calls.length).toBe(settled)
  })
})
