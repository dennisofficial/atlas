import { describe, expect, test } from 'bun:test'

import {
  buildPageTree,
  EFolderKind,
  ENodeType,
  filterTree,
  firstPageUrl,
  folderKindOf,
  staticPagePaths,
  type FolderNode,
  type TreeNode,
} from '../page-tree'

const PAGE_DIRS = [
  ['(public)', 'sign-in'],
  ['(public)', 'invite', '[id]'],
  ['(private)', '(shell)', 'threads', '[threadId]'],
  ['(private)', '(shell)', 'settings'],
  ['(private)', '(shell)', 'settings', '[page]'],
  ['(private)', '(shell)', 'projects', '[projectId]', 'settings', '[section]'],
]

const SAMPLES = {
  '/invite/[id]': [{ label: 'Invitation', path: '/invite/inv-demo' }],
  '/threads/[threadId]': [
    { label: 'Session', path: '/threads/thr-1' },
    { label: 'Other', path: '/threads/thr-2' },
  ],
  '/settings/[page]': [{ label: 'Account', path: '/settings/account' }],
  '/projects/[projectId]/settings/[section]': [
    { label: 'Overview', path: '/projects/rs-crm/settings/overview' },
  ],
}

function tree() {
  return buildPageTree({ pageDirs: PAGE_DIRS, samples: SAMPLES })
}

function folder(nodes: TreeNode[], name: string): FolderNode {
  const found = nodes.find((node) => node.type === ENodeType.Folder && node.name === name)
  if (!found || found.type !== ENodeType.Folder) throw new Error(`missing folder ${name}`)
  return found
}

function urls(nodes: TreeNode[]): string[] {
  return nodes.flatMap((node) => (node.type === ENodeType.Page ? [node.url] : urls(node.children)))
}

describe('folderKindOf', () => {
  test('classifies groups, dynamic segments and plain folders', () => {
    expect(folderKindOf('(public)')).toBe(EFolderKind.Group)
    expect(folderKindOf('[threadId]')).toBe(EFolderKind.Dynamic)
    expect(folderKindOf('settings')).toBe(EFolderKind.Static)
  })
})

describe('buildPageTree', () => {
  test('keeps route groups as folders nested as on disk', () => {
    const roots = tree()
    expect(roots.map((node) => (node.type === ENodeType.Folder ? node.name : node.label))).toEqual([
      '(private)',
      '(public)',
    ])
    const priv = folder(roots, '(private)')
    expect(priv.kind).toBe(EFolderKind.Group)
    const shell = folder(priv.children, '(shell)')
    expect(shell.kind).toBe(EFolderKind.Group)
    expect(shell.children.map((node) => node.type)).toEqual([
      ENodeType.Folder,
      ENodeType.Folder,
      ENodeType.Folder,
    ])
  })

  test('leaf URLs have the groups stripped', () => {
    const roots = tree()
    expect(urls(roots)).toContain('/sign-in')
    expect(urls(roots).some((url) => url.includes('('))).toBe(false)
  })

  test('a dynamic leaf is one page named as on disk that opens the first sample', () => {
    const shell = folder(folder(tree(), '(private)').children, '(shell)')
    const threads = folder(shell.children, 'threads')
    expect(threads.children).toEqual([
      {
        type: ENodeType.Page,
        id: '(private)/(shell)/threads/[threadId]::page',
        label: '[threadId]',
        url: '/threads/thr-1',
        pattern: '/threads/[threadId]',
      },
    ])
  })

  test('static nesting stays as folders down to the dynamic leaf', () => {
    const shell = folder(folder(tree(), '(private)').children, '(shell)')
    const projects = folder(shell.children, 'projects')
    const byId = folder(projects.children, '[projectId]')
    const settings = folder(byId.children, 'settings')
    const leaf = settings.children.find(
      (node) => node.type === ENodeType.Page && node.label === '[section]',
    )
    expect(leaf?.type === ENodeType.Page && leaf.url).toBe('/projects/rs-crm/settings/overview')
  })

  test('a dynamic segment with a page and nested routes lists the page first', () => {
    const roots = buildPageTree({
      pageDirs: [
        ['a', '[x]'],
        ['a', '[x]', 'b'],
      ],
      samples: { '/a/[x]': [{ label: 'One', path: '/a/1' }] },
    })
    const dynamic = folder(folder(roots, 'a').children, '[x]')
    expect(dynamic.kind).toBe(EFolderKind.Dynamic)
    const [first] = dynamic.children
    expect(first?.type === ENodeType.Page && first.pattern).toBe('/a/[x]')
  })

  test('a folder with its own page lists an index leaf before the dynamic leaf', () => {
    const shell = folder(folder(tree(), '(private)').children, '(shell)')
    const settings = folder(shell.children, 'settings')
    const [first, second] = settings.children
    expect(first?.type === ENodeType.Page && first.url).toBe('/settings')
    expect(second?.type === ENodeType.Page && second.label).toBe('[page]')
  })

  test('dynamic folders without samples are dropped', () => {
    const roots = buildPageTree({ pageDirs: PAGE_DIRS, samples: {} })
    expect(urls(roots)).toEqual(['/settings', '/sign-in'])
  })

  test('nested dynamic segments resolve samples against the stripped route pattern', () => {
    expect(urls(tree())).toContain('/projects/rs-crm/settings/overview')
  })

  test('a root page becomes the first leaf', () => {
    const roots = buildPageTree({ pageDirs: [[], ['about']], samples: {} })
    expect(urls(roots)).toEqual(['/', '/about'])
  })
})

describe('filterTree', () => {
  test('returns the tree untouched for an empty query', () => {
    const roots = tree()
    expect(filterTree({ nodes: roots, query: '  ' })).toBe(roots)
  })

  test('matches the URL path and keeps the enclosing groups', () => {
    const result = filterTree({ nodes: tree(), query: 'thr-1' })
    expect(urls(result)).toEqual(['/threads/thr-1'])
    const priv = folder(result, '(private)')
    expect(folder(priv.children, '(shell)').children).toHaveLength(1)
  })

  test('matches folder names including route groups and keeps their whole subtree', () => {
    const result = filterTree({ nodes: tree(), query: '(public)' })
    expect(urls(result)).toEqual(['/sign-in', '/invite/inv-demo'])
    expect(filterTree({ nodes: tree(), query: 'shell' })).toHaveLength(1)
  })

  test('is case-insensitive and returns nothing when nothing matches', () => {
    expect(urls(filterTree({ nodes: tree(), query: 'SIGN-IN' }))).toEqual(['/sign-in'])
    expect(filterTree({ nodes: tree(), query: 'zzz' })).toEqual([])
  })
})

describe('firstPageUrl', () => {
  test('finds the first leaf depth-first', () => {
    expect(firstPageUrl(tree())).toBe('/projects/rs-crm/settings/overview')
    expect(firstPageUrl([])).toBeNull()
  })
})

describe('staticPagePaths', () => {
  test('lists the URL of every static page and skips dynamic ones', () => {
    const nodes = buildPageTree({
      pageDirs: [
        ['(private)', '(shell)', 'threads', 'new'],
        ['(private)', '(shell)', 'threads', '[threadId]'],
      ],
      samples: { '/threads/[threadId]': [{ label: 'Session', path: '/threads/thr-1' }] },
    })
    expect([...staticPagePaths(nodes)]).toEqual(['/threads/new'])
  })
})
