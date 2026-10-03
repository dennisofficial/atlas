import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ContextBrowser,
  EClientFrame,
  EClientRequest,
  EServeFrame,
  MAX_MENTION_BYTES,
} from '@dltech/atlas-harness'

import { answerContextRead, isContextOp } from '../context-requests'
import type { RequestFrame } from '../request-reply'

const homes: string[] = []

afterEach(async () => {
  await Promise.all(homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const frameOf = (op: EClientRequest, params: unknown): RequestFrame => ({
  kind: EClientFrame.Request,
  id: 'req-1',
  op,
  params,
})

async function fixture(files: Record<string, string> = {}): Promise<ContextBrowser> {
  const root = await mkdtemp(join(tmpdir(), 'atlas-serve-context-'))
  homes.push(root)
  for (const [path, content] of Object.entries(files)) await writeFile(join(root, path), content)
  return new ContextBrowser({ root })
}

describe('context ops', () => {
  it('classifies the two context ops', () => {
    expect(isContextOp(EClientRequest.ListContextFiles)).toBe(true)
    expect(isContextOp(EClientRequest.ReadContextFile)).toBe(true)
    expect(isContextOp(EClientRequest.ReadEvents)).toBe(false)
  })

  it('answers list-context-files with the folder entries', async () => {
    const context = await fixture({ 'a.md': 'a', 'b.md': 'b' })

    const reply = await answerContextRead({ frame: frameOf(EClientRequest.ListContextFiles, {}), context })

    expect(reply.kind).toBe(EServeFrame.Reply)
    expect(reply.ok).toBe(true)
    expect(reply.data).toEqual({
      entries: [
        { name: 'a.md', isDirectory: false },
        { name: 'b.md', isDirectory: false },
      ],
    })
  })

  it('answers an absent folder as an empty listing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'atlas-serve-context-'))
    homes.push(home)
    const root = join(home, 'never-created')
    const context = new ContextBrowser({ root })

    const reply = await answerContextRead({ frame: frameOf(EClientRequest.ListContextFiles, undefined), context })

    expect(reply.ok).toBe(true)
    expect(reply.data).toEqual({ entries: [] })
  })

  it('answers read-context-file with the file content', async () => {
    const context = await fixture({ 'plan.md': '# plan\n' })

    const reply = await answerContextRead({ frame: frameOf(EClientRequest.ReadContextFile, { path: 'plan.md' }), context })

    expect(reply.ok).toBe(true)
    expect(reply.data).toEqual({ file: { type: 'text', content: '# plan\n', truncated: false } })
  })

  it('refuses a traversal path instead of reading outside the folder', async () => {
    const context = await fixture({ 'plan.md': 'p' })

    const reply = await answerContextRead({ frame: frameOf(EClientRequest.ReadContextFile, { path: '../plan.md' }), context })

    expect(reply.ok).toBe(true)
    const { file } = reply.data as { file: { type: string } }
    expect(file.type).toBe('refused')
  })

  it('reads a complete file beyond the mention ceiling', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-serve-context-'))
    homes.push(root)
    await writeFile(join(root, 'big.txt'), 'x'.repeat(MAX_MENTION_BYTES + 5))
    const context = new ContextBrowser({ root })

    const reply = await answerContextRead({ frame: frameOf(EClientRequest.ReadContextFile, { path: 'big.txt' }), context })

    const { file } = reply.data as { file: { type: string; truncated?: boolean; content?: string } }
    expect(file.type).toBe('text')
    expect(file.truncated).toBe(false)
    expect(file.content?.length).toBe(MAX_MENTION_BYTES + 5)
  })

  it('refuses malformed params with a legible message', async () => {
    const context = await fixture()

    const list = await answerContextRead({ frame: frameOf(EClientRequest.ListContextFiles, 42), context })
    const file = await answerContextRead({ frame: frameOf(EClientRequest.ReadContextFile, {}), context })

    expect(list.ok).toBe(false)
    expect(file.ok).toBe(false)
  })
})
