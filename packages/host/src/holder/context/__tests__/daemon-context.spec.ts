import type { FileStat, FileSystemEntry } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import {
  CONTEXT_SCAN_LIMIT,
  contextRemovableFrom,
  scanContextDir,
  type ContextReader,
} from '../daemon-context'

const ROOT = '/context'

const fileEntry = (name: string): FileSystemEntry => ({
  name,
  isFile: () => true,
  isDirectory: () => false,
})

const dirEntry = (name: string): FileSystemEntry => ({
  name,
  isFile: () => false,
  isDirectory: () => true,
})

const statOf = (size: number): FileStat => ({
  size,
  mode: 0o644,
  mtimeMs: 1,
  isFile: () => true,
  isDirectory: () => false,
})

const readerOf = (args: {
  directories: Record<string, readonly FileSystemEntry[]>
  stats?: Record<string, number> | undefined
  failStats?: readonly string[] | undefined
}): ContextReader => ({
  readDirectory: async ({ path }) => {
    const entries = args.directories[path]
    if (entries === undefined) throw new Error(`ENOENT: ${path}`)
    return entries
  },
  stat: async ({ path }) => {
    if (args.failStats?.includes(path) === true) throw new Error(`EIO: ${path}`)
    const size = args.stats?.[path]
    if (size === undefined) throw new Error(`ENOENT: ${path}`)
    return statOf(size)
  },
})

describe('scanContextDir', () => {
  it('walks a complete tree and names every file by its relative path', async () => {
    const files = readerOf({
      directories: {
        [ROOT]: [fileEntry('notes.md'), dirEntry('sub')],
        [`${ROOT}/sub`]: [fileEntry('inner.md')],
      },
      stats: { [`${ROOT}/notes.md`]: 4, [`${ROOT}/sub/inner.md`]: 9 },
    })

    expect(await scanContextDir({ files, root: ROOT })).toEqual({
      files: [
        { path: 'notes.md', size: 4, mtimeMs: 1 },
        { path: 'sub/inner.md', size: 9, mtimeMs: 1 },
      ],
      complete: true,
      incompleteDirs: [],
    })
  })

  it('names a subdirectory it could not read and keeps the rest of the tree', async () => {
    const files = readerOf({
      directories: { [ROOT]: [fileEntry('notes.md'), dirEntry('locked')] },
      stats: { [`${ROOT}/notes.md`]: 4 },
    })

    expect(await scanContextDir({ files, root: ROOT })).toEqual({
      files: [{ path: 'notes.md', size: 4, mtimeMs: 1 }],
      complete: false,
      incompleteDirs: ['locked/'],
    })
  })

  it('names the directory of a file it could not stat', async () => {
    const files = readerOf({
      directories: { [ROOT]: [dirEntry('sub')], [`${ROOT}/sub`]: [fileEntry('bad.md')] },
      stats: {},
      failStats: [`${ROOT}/sub/bad.md`],
    })

    expect(await scanContextDir({ files, root: ROOT })).toEqual({
      files: [],
      complete: false,
      incompleteDirs: ['sub/'],
    })
  })

  it('reports an incomplete scan with no directory named when it hits the cap', async () => {
    const entries = Array.from({ length: CONTEXT_SCAN_LIMIT + 5 }, (_value, index) =>
      fileEntry(`file-${index}.md`),
    )
    const stats: Record<string, number> = {}
    for (const entry of entries) stats[`${ROOT}/${entry.name}`] = 1
    const files = readerOf({ directories: { [ROOT]: entries }, stats })

    const scan = await scanContextDir({ files, root: ROOT })

    expect(scan.files).toHaveLength(CONTEXT_SCAN_LIMIT)
    expect(scan.complete).toBe(false)
    expect(scan.incompleteDirs).toEqual([])
  })

  it('throws when the root itself cannot be read', async () => {
    const files = readerOf({ directories: {} })

    await expect(scanContextDir({ files, root: ROOT })).rejects.toThrow(`ENOENT: ${ROOT}`)
  })
})

describe('contextRemovableFrom', () => {
  const files = [{ path: 'a.md', size: 1, mtimeMs: 1 }]

  it('removes an unscanned path after a complete scan', () => {
    expect(
      contextRemovableFrom({
        scan: { files, complete: true, incompleteDirs: [] },
        path: 'gone.md',
      }),
    ).toBe(true)
  })

  it('removes nothing when the scan hit the cap', () => {
    expect(
      contextRemovableFrom({
        scan: { files, complete: false, incompleteDirs: [] },
        path: 'gone.md',
      }),
    ).toBe(false)
  })

  it('keeps a path under a directory it could not read', () => {
    const scan = { files, complete: false, incompleteDirs: ['sub/'] }
    expect(contextRemovableFrom({ scan, path: 'sub/gone.md' })).toBe(false)
    expect(contextRemovableFrom({ scan, path: 'subfile.md' })).toBe(true)
  })
})
