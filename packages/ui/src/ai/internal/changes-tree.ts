import type { ChangedFile } from './changes-types'

export interface ChangeDirNode {
  kind: 'dir'
  path: string
  name: string
  added: number
  removed: number
  children: ChangeTreeNode[]
}

export interface ChangeFileNode {
  kind: 'file'
  name: string
  file: ChangedFile
}

export type ChangeTreeNode = ChangeDirNode | ChangeFileNode

interface Trie {
  dirs: Map<string, Trie>
  files: { name: string; file: ChangedFile }[]
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

function insert({ root, file }: { root: Trie; file: ChangedFile }) {
  const parts = file.path.split('/')
  const name = parts.pop() ?? file.path
  let node = root
  for (const part of parts) {
    let next = node.dirs.get(part)
    if (next === undefined) {
      next = { dirs: new Map(), files: [] }
      node.dirs.set(part, next)
    }
    node = next
  }
  node.files.push({ name, file })
}

function dirNode({ name, trie, prefix }: { name: string; trie: Trie; prefix: string }) {
  let label = name
  let node = trie
  while (node.files.length === 0 && node.dirs.size === 1) {
    const [only] = node.dirs
    if (only === undefined) break
    label = `${label}/${only[0]}`
    node = only[1]
  }
  const path = prefix === '' ? label : `${prefix}/${label}`
  const children = toNodes({ trie: node, prefix: path })
  const totals = { added: 0, removed: 0 }
  for (const child of children) {
    const source = child.kind === 'dir' ? child : child.file
    totals.added += source.added
    totals.removed += source.removed
  }
  const result: ChangeDirNode = {
    kind: 'dir',
    path,
    name: label,
    children,
    ...totals,
  }
  return result
}

function toNodes({ trie, prefix }: { trie: Trie; prefix: string }): ChangeTreeNode[] {
  const dirs = [...trie.dirs]
    .map(([name, child]) => ({ name, child }))
    .sort(byName)
    .map(({ name, child }) => dirNode({ name, trie: child, prefix }))
  const files = [...trie.files]
    .sort(byName)
    .map(({ name, file }): ChangeFileNode => ({ kind: 'file', name, file }))
  return [...dirs, ...files]
}

export function buildChangeTree(files: readonly ChangedFile[]): ChangeTreeNode[] {
  const root: Trie = { dirs: new Map(), files: [] }
  for (const file of files) insert({ root, file })
  return toNodes({ trie: root, prefix: '' })
}
