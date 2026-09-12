import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { walkGlob } from '../walk-glob'

describe('walkGlob', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'atlas-walk-glob-'))
    await mkdir(join(root, 'one'), { recursive: true })
    await mkdir(join(root, 'two'), { recursive: true })
    await writeFile(join(root, 'one', 'a.txt'), 'a')
    await writeFile(join(root, 'two', 'b.txt'), 'b')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('finds every matching file when the signal never aborts', async () => {
    const found = await walkGlob({ pattern: '**/*.txt', cwd: root, dot: false, signal: new AbortController().signal })

    expect([...found].sort()).toEqual([join(root, 'one', 'a.txt'), join(root, 'two', 'b.txt')].sort())
  })

  it('stops the walk on an aborted signal instead of visiting the tree', async () => {
    const controller = new AbortController()
    controller.abort()

    const found = await walkGlob({ pattern: '**/*.txt', cwd: root, dot: false, signal: controller.signal })

    expect(found).toEqual([])
  })
})
