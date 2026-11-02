import { describe, expect, it } from 'bun:test'

import { EFileChange, type ChangedFile } from '@dltech/atlas-ui/ai/changes-panel'

import {
  findChangedRow,
  resolveChangedPath,
  withExpanded,
  withoutCollapsedAncestors,
} from '../focus-changed-path'

const file = (path: string): ChangedFile => ({
  path,
  added: 1,
  removed: 0,
  change: EFileChange.Modified,
})

describe('resolveChangedPath', () => {
  const files = [file('src/a.ts'), file('README.md')]

  it('finds an exact path', () => {
    expect(resolveChangedPath({ files, path: 'src/a.ts' })).toBe('src/a.ts')
  })

  it('finds a changed file named by an absolute path under the workspace', () => {
    expect(resolveChangedPath({ files, path: '/workspace/repo/src/a.ts' })).toBe('src/a.ts')
  })

  it('returns undefined when the file is not in the list', () => {
    expect(resolveChangedPath({ files, path: 'src/b.ts' })).toBeUndefined()
  })
})

describe('withExpanded', () => {
  it('adds a path once', () => {
    expect(withExpanded({ expanded: ['a'], path: 'b' })).toEqual(['a', 'b'])
    expect(withExpanded({ expanded: ['a', 'b'], path: 'b' })).toEqual(['a', 'b'])
  })
})

describe('withoutCollapsedAncestors', () => {
  it('reopens every collapsed folder above the file and keeps the rest', () => {
    expect(
      withoutCollapsedAncestors({
        collapsed: ['src', 'src/deep/x', 'other', 'sr'],
        path: 'src/deep/x/a.ts',
      }),
    ).toEqual(['other', 'sr'])
  })
})

describe('findChangedRow', () => {
  it('matches a row by its changed path, in any layout', () => {
    const rows = [{ getAttribute: () => 'a/b.ts' }, { getAttribute: () => 'c.ts' }]
    const root = { querySelectorAll: () => rows } as unknown as ParentNode
    expect(findChangedRow({ root, path: 'c.ts' })).toBe(rows[1] as unknown as Element)
    expect(findChangedRow({ root, path: 'zzz' })).toBeNull()
  })
})
