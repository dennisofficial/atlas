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
    const nodes = nodesOf({ listings, changes: new Map(), ignored: new Set() })
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
    const nodes = nodesOf({
      listings,
      changes: new Map([['src/a.ts', EFileChange.Added]]),
      ignored: new Set(),
    })
    expect(nodes[0]?.children?.[0]?.change).toBe(EFileChange.Added)
    expect(nodes[1]?.change).toBeUndefined()
  })

  it('is empty before the root loads', () => {
    expect(nodesOf({ listings: new Map(), changes: new Map(), ignored: new Set() })).toEqual([])
  })

  it('tints a folder with the status of the changes beneath it, mixed ones as modified', () => {
    const only = nodesOf({
      listings,
      changes: new Map([['src/a.ts', EFileChange.Added]]),
      ignored: new Set(),
    })
    expect(only[0]?.change).toBe(EFileChange.Added)

    const mixed = nodesOf({
      listings,
      changes: new Map([
        ['src/a.ts', EFileChange.Added],
        ['src/deep/b.ts', EFileChange.Deleted],
      ]),
      ignored: new Set(),
    })
    expect(mixed[0]?.change).toBe(EFileChange.Modified)
    expect(mixed[0]?.children?.find((node) => node.name === 'deep')?.change).toBe(
      EFileChange.Deleted,
    )
  })

  it('keeps deleted files and folders in the tree where they used to be', () => {
    const nodes = nodesOf({
      listings,
      changes: new Map([
        ['src/gone.ts', EFileChange.Deleted],
        ['old/x.ts', EFileChange.Deleted],
      ]),
      ignored: new Set(),
    })
    expect(nodes.map((node) => node.name)).toEqual(['old', 'src', 'README.md'])
    expect(nodes[0]?.children).toEqual([
      { path: 'old/x.ts', name: 'x.ts', change: EFileChange.Deleted },
    ])
    expect(nodes[1]?.children?.find((node) => node.name === 'gone.ts')?.change).toBe(
      EFileChange.Deleted,
    )
  })

  it('dims ignored paths and everything inside an ignored folder, unless it changed', () => {
    const nodes = nodesOf({
      listings: new Map([
        ['', [dir('dist'), file('debug.log'), file('README.md')]],
        ['dist', [file('out.js')]],
      ]),
      changes: new Map([['debug.log', EFileChange.Modified]]),
      ignored: new Set(['dist', 'debug.log']),
    })
    expect(nodes[0]).toMatchObject({ name: 'dist', ignored: true })
    expect(nodes[0]?.children?.[0]).toMatchObject({ name: 'out.js', ignored: true })
    expect(nodes[1]).toEqual({ path: 'debug.log', name: 'debug.log', change: EFileChange.Modified })
    expect(nodes[2]?.ignored).toBeUndefined()
  })
})
