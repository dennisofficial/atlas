import { describe, expect, it } from 'bun:test'

import { EFileChange, type ChangedFile } from '@dltech/atlas-ui/ai/changes-panel'

import { resolveChangedPath, withExpanded } from '../focus-changed-path'

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
