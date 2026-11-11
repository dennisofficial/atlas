import { describe, expect, it } from 'bun:test'

import { artifactFileTree, entriesOfTree } from '../artifact-file-tree'
import { manifestEntry } from './fixtures'

const MANIFEST = [
  manifestEntry({ path: 'index.html' }),
  manifestEntry({ path: 'assets/app.css', type: 'text/css' }),
  manifestEntry({ path: 'assets/img/logo.svg', type: 'image/svg+xml' }),
  manifestEntry({ path: 'app/page.tsx', tree: 'src', type: 'text/typescript' }),
]

describe('entriesOfTree', () => {
  it('keeps only the entries of the asked tree', () => {
    expect(entriesOfTree({ manifest: MANIFEST, tree: 'dist' }).map((entry) => entry.path)).toEqual([
      'index.html',
      'assets/app.css',
      'assets/img/logo.svg',
    ])
    expect(entriesOfTree({ manifest: MANIFEST, tree: 'src' }).map((entry) => entry.path)).toEqual([
      'app/page.tsx',
    ])
  })
})

describe('artifactFileTree', () => {
  it('groups nested paths into directories with the files under them', () => {
    const tree = artifactFileTree(entriesOfTree({ manifest: MANIFEST, tree: 'dist' }))

    expect(tree.map((node) => node.name)).toEqual(['assets', 'index.html'])
    const assets = tree[0]
    expect(assets?.path).toBe('assets')
    expect(assets?.entry).toBeNull()
    expect(assets?.children.map((node) => node.name)).toEqual(['img', 'app.css'])

    const image = assets?.children[0]
    expect(image?.path).toBe('assets/img')
    expect(image?.children[0]?.path).toBe('assets/img/logo.svg')
    expect(image?.children[0]?.entry?.type).toBe('image/svg+xml')

    expect(tree[1]?.entry?.path).toBe('index.html')
    expect(tree[1]?.children).toEqual([])
  })

  it('builds an empty tree for an empty selection', () => {
    expect(artifactFileTree([])).toEqual([])
  })

  it('ignores repeated and leading slashes in a stored path', () => {
    const tree = artifactFileTree([
      manifestEntry({ path: '/assets//app.css' }),
      manifestEntry({ path: 'assets/app.css' }),
    ])

    expect(tree.map((node) => node.name)).toEqual(['assets'])
    expect(tree[0]?.children.map((node) => node.name)).toEqual(['app.css'])
  })
})
