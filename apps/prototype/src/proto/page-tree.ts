import type { ProtoSample } from './samples'

export enum ENodeType {
  Folder = 'folder',
  Page = 'page',
}

export enum EFolderKind {
  Static = 'static',
  Group = 'group',
  Dynamic = 'dynamic',
}

export interface PageNode {
  type: ENodeType.Page
  id: string
  label: string
  url: string
  pattern?: string
}

export interface FolderNode {
  type: ENodeType.Folder
  id: string
  name: string
  kind: EFolderKind
  children: TreeNode[]
}

export type TreeNode = PageNode | FolderNode

interface DirEntry {
  name: string
  hasPage: boolean
  children: Map<string, DirEntry>
}

interface ConvertContext {
  samples: Record<string, ProtoSample[]>
}

const INDEX_LABEL = 'index'

export function folderKindOf(name: string): EFolderKind {
  if (name.startsWith('(') && name.endsWith(')')) return EFolderKind.Group
  if (name.startsWith('[') && name.endsWith(']')) return EFolderKind.Dynamic
  return EFolderKind.Static
}

function toUrl(segments: string[]): string {
  return `/${segments.join('/')}`
}

function buildDirs(pageDirs: string[][]): DirEntry {
  const root: DirEntry = { name: '', hasPage: false, children: new Map() }
  for (const segments of pageDirs) {
    let dir = root
    for (const segment of segments) {
      const existing = dir.children.get(segment)
      const next = existing ?? { name: segment, hasPage: false, children: new Map() }
      dir.children.set(segment, next)
      dir = next
    }
    dir.hasPage = true
  }
  return root
}

function pagesFirst(nodes: TreeNode[]): TreeNode[] {
  const pages = nodes.filter((node) => node.type === ENodeType.Page)
  const folders = nodes.filter((node) => node.type === ENodeType.Folder)
  return [...pages, ...folders]
}

function ownPages({
  dir,
  kind,
  id,
  url,
  context,
}: {
  dir: DirEntry
  kind: EFolderKind
  id: string
  url: string
  context: ConvertContext
}): PageNode[] {
  if (!dir.hasPage) return []
  if (kind === EFolderKind.Dynamic) {
    return dynamicLeaf({ name: INDEX_LABEL, id, pattern: url, context })
  }
  return [{ type: ENodeType.Page, id: `${id}::${INDEX_LABEL}`, label: INDEX_LABEL, url }]
}

function dynamicLeaf({
  name,
  id,
  pattern,
  context,
}: {
  name: string
  id: string
  pattern: string
  context: ConvertContext
}): PageNode[] {
  const first = context.samples[pattern]?.[0]
  if (!first) return []
  return [{ type: ENodeType.Page, id: `${id}::page`, label: name, url: first.path, pattern }]
}

function convertChildren({
  dir,
  diskPath,
  urlSegments,
  context,
}: {
  dir: DirEntry
  diskPath: string[]
  urlSegments: string[]
  context: ConvertContext
}): TreeNode[] {
  const sorted = [...dir.children.values()].sort((a, b) => a.name.localeCompare(b.name))
  const nodes = sorted.flatMap((child) => convertDir({ child, diskPath, urlSegments, context }))
  return pagesFirst(nodes)
}

function convertDir({
  child,
  diskPath,
  urlSegments,
  context,
}: {
  child: DirEntry
  diskPath: string[]
  urlSegments: string[]
  context: ConvertContext
}): TreeNode[] {
  const kind = folderKindOf(child.name)
  const childDisk = [...diskPath, child.name]
  const id = childDisk.join('/')
  const childUrlSegments = kind === EFolderKind.Group ? urlSegments : [...urlSegments, child.name]
  const url = toUrl(childUrlSegments)
  const nested = convertChildren({
    dir: child,
    diskPath: childDisk,
    urlSegments: childUrlSegments,
    context,
  })
  if (child.hasPage && nested.length === 0 && kind === EFolderKind.Static) {
    return [{ type: ENodeType.Page, id: `${id}::page`, label: child.name, url }]
  }
  if (child.hasPage && nested.length === 0 && kind === EFolderKind.Dynamic) {
    return dynamicLeaf({ name: child.name, id, pattern: url, context })
  }
  const children = [...ownPages({ dir: child, kind, id, url, context }), ...nested]
  if (children.length === 0) return []
  return [{ type: ENodeType.Folder, id, name: child.name, kind, children }]
}

export function buildPageTree({
  pageDirs,
  samples,
}: {
  pageDirs: string[][]
  samples: Record<string, ProtoSample[]>
}): TreeNode[] {
  const root = buildDirs(pageDirs)
  const context = { samples }
  const rootPage: PageNode[] = root.hasPage
    ? [{ type: ENodeType.Page, id: INDEX_LABEL, label: INDEX_LABEL, url: '/' }]
    : []
  return [...rootPage, ...convertChildren({ dir: root, diskPath: [], urlSegments: [], context })]
}

function pageMatches({ node, query }: { node: PageNode; query: string }): boolean {
  return node.url.toLowerCase().includes(query) || node.label.toLowerCase().includes(query)
}

export function filterTree({ nodes, query }: { nodes: TreeNode[]; query: string }): TreeNode[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return nodes
  return nodes.flatMap((node): TreeNode[] => {
    if (node.type === ENodeType.Page) return pageMatches({ node, query: needle }) ? [node] : []
    if (node.name.toLowerCase().includes(needle)) return [node]
    const children = filterTree({ nodes: node.children, query: needle })
    return children.length > 0 ? [{ ...node, children }] : []
  })
}

export function staticPagePaths(nodes: TreeNode[]): ReadonlySet<string> {
  const paths = nodes.flatMap(function collect(node: TreeNode): string[] {
    if (node.type === ENodeType.Folder) return node.children.flatMap(collect)
    return node.pattern ? [] : [node.url]
  })
  return new Set(paths)
}

export function firstPageUrl(nodes: TreeNode[]): string | null {
  for (const node of nodes) {
    if (node.type === ENodeType.Page) return node.url
    const nested = firstPageUrl(node.children)
    if (nested) return nested
  }
  return null
}
