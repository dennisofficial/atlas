import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { scanContextSignature, type ScannedEntry } from '../context-signature'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function context() {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-context-signature-'))
  dirs.push(dir)
  return dir
}

describe('scanContextSignature', () => {
  it('reports an absent directory as empty and not capped', async () => {
    expect(await scanContextSignature({ context: join(await context(), 'missing') })).toEqual({ signature: '', capped: false })
  })

  it('sees a nested change', async () => {
    const dir = await context()
    await mkdir(join(dir, 'a', 'b'), { recursive: true })
    await writeFile(join(dir, 'a', 'b', 'deep.md'), 'one')
    const before = await scanContextSignature({ context: dir })
    await writeFile(join(dir, 'a', 'b', 'deep.md'), 'longer content')
    const after = await scanContextSignature({ context: dir })
    expect(after.signature).not.toBe(before.signature)
    expect(after.capped).toBe(false)
  })

  it('is stable when nothing changed', async () => {
    const dir = await context()
    await writeFile(join(dir, 'notes.md'), 'one')
    expect((await scanContextSignature({ context: dir })).signature).toBe((await scanContextSignature({ context: dir })).signature)
  })

  it('stops walking at the limit and says it was capped', async () => {
    const dir = await context()
    for (const name of ['a', 'b', 'c', 'd', 'e']) await writeFile(join(dir, `${name}.md`), name)
    const scan = await scanContextSignature({ context: dir, limit: 3 })
    expect(scan.capped).toBe(true)
    expect(scan.signature.split('\n')).toHaveLength(3)
    expect((await scanContextSignature({ context: dir, limit: 5 })).capped).toBe(false)
  })

  it('stops enumerating a wide directory at the cap and closes the handle', async () => {
    let read = 0
    let closed = false
    const wide = (): AsyncIterable<ScannedEntry> => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          read += 1
          return read > 100_000 ? { done: true, value: undefined } : { done: false, value: { name: `f${read}`, isDirectory: () => false } }
        },
        return: async () => { closed = true; return { done: true, value: undefined } },
      }),
    })
    const scan = await scanContextSignature({ context: await context(), limit: 3, open: async () => wide() })
    expect(scan.capped).toBe(true)
    expect(scan.signature.split('\n')).toHaveLength(3)
    expect(read).toBe(4)
    expect(closed).toBe(true)
  })

  it('bounds a real directory wider than the limit', async () => {
    const dir = await context()
    for (let index = 0; index < 60; index += 1) await writeFile(join(dir, `f${index}.md`), 'x')
    const scan = await scanContextSignature({ context: dir, limit: 10 })
    expect(scan.capped).toBe(true)
    expect(scan.signature.split('\n')).toHaveLength(10)
  })
})
