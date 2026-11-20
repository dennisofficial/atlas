import { describe, expect, it } from 'bun:test'

import { dirs, file, rig, turn } from './repo-agent-rig'

const docsWriter = [
  '---',
  'description: Writes the docs a change needs.',
  '---',
  '',
  'Write.',
].join('\n')

const securityReviewer = [
  '---',
  'description: Reviews the auth path.',
  '---',
  '',
  'Review authentication code.',
].join('\n')

const nodes = {
  ...dirs('/work/.agents/agents'),
  ...Object.fromEntries([file('/work/.agents/agents/docs-writer.md', docsWriter)]),
}

const settle = async (ready: () => Promise<boolean>): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await ready()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('the repository agent types never settled')
}

describe('a turn after the first', () => {
  it('reads no file when the repository has not changed', async () => {
    const { ctx, calls } = rig({ nodes })
    await turn({ ctx })
    const reads = calls.length

    const blocks = await turn({ ctx })
    expect(calls.length).toBe(reads)
    expect(blocks.at(-1)).toContain('- docs-writer: Writes the docs a change needs.')
  })

  it('picks up a type the watcher reports without the turn reading anything', async () => {
    const { ctx, calls, emit } = rig({ nodes })
    await turn({ ctx })
    const reads = calls.length

    const added = await turn({ ctx })
    expect(calls.length).toBe(reads)
    expect(added.join('\n')).not.toContain('security-reviewer')

    nodes['/work/.agents/agents/security-reviewer.md'] = {
      kind: 'file',
      text: securityReviewer,
    }
    emit({
      type: 'watch.changed',
      watchId: 'crew:s1',
      paths: ['/work/.agents/agents/security-reviewer.md'],
    })
    await settle(async () => (await turn({ ctx })).join('\n').includes('security-reviewer'))

    expect((await turn({ ctx })).join('\n')).toContain(
      '- security-reviewer: Reviews the auth path.',
    )
  })
})
