import { describe, expect, it } from 'bun:test'

import { EChangeFileStatus } from '@dltech/atlas-protocol'

import type { ChangedFileWrite } from '../../port'
import { diffChangedFiles } from '../postgres-changes'

const fileOf = (path: string, overrides: Partial<ChangedFileWrite> = {}): ChangedFileWrite => ({
  path,
  oldPath: null,
  status: EChangeFileStatus.Modified,
  additions: 1,
  deletions: 2,
  binary: false,
  baseHash: 'a'.repeat(64),
  currentHash: 'b'.repeat(64),
  size: 12,
  ...overrides,
})

describe('diffChangedFiles', () => {
  it('writes nothing when the manifest is unchanged', () => {
    const files = [fileOf('src/a.ts'), fileOf('src/b.ts', { status: EChangeFileStatus.Added })]
    expect(diffChangedFiles({ stored: files, next: files })).toEqual({
      removed: [],
      written: [],
    })
  })

  it('writes an added path and removes nothing', () => {
    const diff = diffChangedFiles({
      stored: [fileOf('src/a.ts')],
      next: [fileOf('src/a.ts'), fileOf('src/c.ts')],
    })
    expect(diff).toEqual({ removed: [], written: [fileOf('src/c.ts')] })
  })

  it('removes a path that left the manifest and writes nothing else', () => {
    const diff = diffChangedFiles({
      stored: [fileOf('src/a.ts'), fileOf('src/b.ts')],
      next: [fileOf('src/a.ts')],
    })
    expect(diff).toEqual({ removed: ['src/b.ts'], written: [] })
  })

  it('treats a rename as a removed path plus an added path', () => {
    const diff = diffChangedFiles({
      stored: [fileOf('src/a.ts'), fileOf('src/b.ts')],
      next: [
        fileOf('src/a.ts'),
        fileOf('src/c.ts', { oldPath: 'src/b.ts', status: EChangeFileStatus.Added }),
      ],
    })
    expect(diff).toEqual({
      removed: ['src/b.ts'],
      written: [fileOf('src/c.ts', { oldPath: 'src/b.ts', status: EChangeFileStatus.Added })],
    })
  })

  it('writes every changed column of a stored path', () => {
    const stored = fileOf('src/a.ts')
    const changed: readonly [string, ChangedFileWrite][] = [
      ['oldPath', fileOf('src/a.ts', { oldPath: 'src/z.ts' })],
      ['status', fileOf('src/a.ts', { status: EChangeFileStatus.Added })],
      ['additions', fileOf('src/a.ts', { additions: 7 })],
      ['deletions', fileOf('src/a.ts', { deletions: 7 })],
      ['binary', fileOf('src/a.ts', { binary: true })],
      ['baseHash', fileOf('src/a.ts', { baseHash: null })],
      ['currentHash', fileOf('src/a.ts', { currentHash: 'c'.repeat(64) })],
      ['size', fileOf('src/a.ts', { size: null })],
    ]
    for (const [column, next] of changed) {
      expect({ column, diff: diffChangedFiles({ stored: [stored], next: [next] }) }).toEqual({
        column,
        diff: { removed: [], written: [next] },
      })
    }
  })
})
