import type { ArtifactEntry } from '@dltech/atlas-wire'

export type ArtifactTree = 'src' | 'dist'

export type ArtifactFileNode = {
  readonly name: string
  readonly path: string
  readonly entry: ArtifactEntry | null
  readonly children: readonly ArtifactFileNode[]
}

type MutableNode = {
  name: string
  path: string
  entry: ArtifactEntry | null
  children: Map<string, MutableNode>
}

const isDirectory = (node: MutableNode): boolean => node.children.size > 0

function compareNodes(left: MutableNode, right: MutableNode): number {
  const leftDirectory = isDirectory(left)
  const rightDirectory = isDirectory(right)
  if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1
  return left.name.localeCompare(right.name)
}

function childOf(parent: MutableNode, name: string): MutableNode {
  const existing = parent.children.get(name)
  if (existing !== undefined) return existing
  const created: MutableNode = {
    name,
    path: parent.path === '' ? name : `${parent.path}/${name}`,
    entry: null,
    children: new Map(),
  }
  parent.children.set(name, created)
  return created
}

export const entriesOfTree = (args: {
  manifest: readonly ArtifactEntry[]
  tree: ArtifactTree
}): ArtifactEntry[] => args.manifest.filter((entry) => entry.tree === args.tree)

export function artifactFileTree(entries: readonly ArtifactEntry[]): readonly ArtifactFileNode[] {
  const root: MutableNode = { name: '', path: '', entry: null, children: new Map() }
  for (const entry of entries) {
    const segments = entry.path.split('/').filter((segment) => segment.length > 0)
    let node = root
    segments.forEach((segment, index) => {
      node = childOf(node, segment)
      if (index === segments.length - 1) node.entry = entry
    })
  }

  const freeze = (node: MutableNode): ArtifactFileNode => ({
    name: node.name,
    path: node.path,
    entry: node.entry,
    children: [...node.children.values()].sort(compareNodes).map(freeze),
  })

  return [...root.children.values()].sort(compareNodes).map(freeze)
}
