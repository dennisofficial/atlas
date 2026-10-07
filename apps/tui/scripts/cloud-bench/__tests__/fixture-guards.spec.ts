import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { cloneBenchmarkSession } from '../fixture'
import { CHILD, cleanScratch, put, ROOT, setup, treeOf } from './fixture-source'

afterEach(cleanScratch)

describe('cloneBenchmarkSession destination guards', () => {
  it('rejects a destination home whose sessions directory is a symlink into the source home', async () => {
    const { sourceHome, source, destinationHome, workspace } = setup()
    symlinkSync(join(sourceHome, 'sessions'), join(destinationHome, 'sessions'))
    const before = treeOf(sourceHome)

    await expect(
      cloneBenchmarkSession({ sourceSession: source, destinationHome, workspace }),
    ).rejects.toThrow()

    expect(treeOf(sourceHome)).toEqual(before)
    expect(readdirSync(join(sourceHome, 'sessions'))).toEqual([ROOT])
  })

  it('treats a dot-dot-prefixed directory name inside the source as inside', async () => {
    const { source, workspace } = setup()
    const before = treeOf(source)

    await expect(
      cloneBenchmarkSession({
        sourceSession: source,
        destinationHome: join(source, '..hidden'),
        workspace,
      }),
    ).rejects.toThrow(/inside the source/)

    expect(treeOf(source)).toEqual(before)
  })

  it('rejects the source home itself and leaves its sessions untouched', async () => {
    const { sourceHome, source, workspace } = setup()
    const before = treeOf(sourceHome)

    await expect(
      cloneBenchmarkSession({ sourceSession: source, destinationHome: sourceHome, workspace }),
    ).rejects.toThrow()

    expect(treeOf(sourceHome)).toEqual(before)
  })

  it('rejects a destination home that already has a sessions directory, even an empty one', async () => {
    const { source, destinationHome, workspace } = setup()
    mkdirSync(join(destinationHome, 'sessions'))

    await expect(
      cloneBenchmarkSession({ sourceSession: source, destinationHome, workspace }),
    ).rejects.toThrow()

    expect(readdirSync(join(destinationHome, 'sessions'))).toEqual([])
  })
})

describe('cloneBenchmarkSession source integrity', () => {
  it.each(['parentThreadId', 'spawnerThreadId'])(
    'fails closed when %s points outside the discovered threads',
    async (field) => {
      const { source, destinationHome, workspace } = setup()
      const file = join(source, `threads/${CHILD}.meta.json`)
      const meta = JSON.parse(readFileSync(file, 'utf8'))
      writeFileSync(file, JSON.stringify({ ...meta, [field]: 'brn_external' }))

      await expect(
        cloneBenchmarkSession({ sourceSession: source, destinationHome, workspace }),
      ).rejects.toThrow(/brn_external/)

      expect(readdirSync(destinationHome)).toEqual([])
    },
  )

  it('omits thread metadata temp remnants from the clone', async () => {
    const { source, destinationHome, workspace } = setup()
    put(source, `threads/${ROOT}.meta.json.4242.7.tmp`, '{"half":')

    const clone = await cloneBenchmarkSession({ sourceSession: source, destinationHome, workspace })

    const names = readdirSync(join(clone.sessionDirectory, 'threads'))
    expect(names.filter((name) => name.endsWith('.tmp'))).toEqual([])
    expect(names).toContain(`${clone.threadId}.meta.json`)
  })

  it('rejects an events file with no matching thread metadata', async () => {
    const { source, destinationHome, workspace } = setup()
    put(source, 'threads/brn_orphan.events.jsonl', '{"v":1}\n')

    await expect(
      cloneBenchmarkSession({ sourceSession: source, destinationHome, workspace }),
    ).rejects.toThrow(/brn_orphan/)

    expect(readdirSync(destinationHome)).toEqual([])
  })

  it('rejects a thread data directory with no matching thread metadata', async () => {
    const { source, destinationHome, workspace } = setup()
    put(source, 'threads/brn_orphan/notes/a.txt', 'a')

    await expect(
      cloneBenchmarkSession({ sourceSession: source, destinationHome, workspace }),
    ).rejects.toThrow(/brn_orphan/)

    expect(readdirSync(destinationHome)).toEqual([])
  })
})
