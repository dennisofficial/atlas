import { describe, expect, it } from 'bun:test'

import { EFileChange } from '@dltech/atlas-ui/ai/file-tree'

import { nodesOf } from '../file-tree-nodes'
import { orderedEntries, pathWithin, type TreeEntry } from '../file-tree-source'

const dir = (name: string): TreeEntry => ({ name, isDirectory: true })
const file = (name: string): TreeEntry => ({ name, isDirectory: false })

describe('pathWithin', () => {
  it('joins under the root without a leading slash', () => {
    expect(pathWithin({ directory: '', name: 'src' })).toBe('src')
    expect(pathWithin({ directory: 'src', name: 'a.ts' })).toBe('src/a.ts')
  })
})

describe('orderedEntries', () => {
  it('lists directories first, sorted, and hides .git and node_modules', () => {
    const ordered = orderedEntries([
      file('b.ts'),
      dir('src'),
      dir('.git'),
      file('a.ts'),
      dir('node_modules'),
      dir('app'),
    ])
    expect(ordered.map((entry) => entry.name)).toEqual(['app', 'src', 'a.ts', 'b.ts'])
  })
})

describe('nodesOf', () => {
  const listings = new Map<string, TreeEntry[]>([
    ['', [dir('src'), file('README.md')]],
    ['src', [file('a.ts'), dir('deep')]],
  ])

  it('nests loaded directories and leaves unloaded ones empty', () => {
    const nodes = nodesOf({ listings, changes: new Map() })
    expect(nodes).toEqual([
      {
        path: 'src',
        name: 'src',
        children: [
          { path: 'src/a.ts', name: 'a.ts' },
          { path: 'src/deep', name: 'deep', children: [] },
        ],
      },
      { path: 'README.md', name: 'README.md' },
    ])
  })

  it('marks changed files', () => {
    const nodes = nodesOf({ listings, changes: new Map([['src/a.ts', EFileChange.Added]]) })
    expect(nodes[0]?.children?.[0]?.change).toBe(EFileChange.Added)
    expect(nodes[1]?.change).toBeUndefined()
  })

  it('is empty before the root loads', () => {
    expect(nodesOf({ listings: new Map(), changes: new Map() })).toEqual([])
  })
})
