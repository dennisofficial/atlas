import { EFileChange, type FileNode } from '@dltech/atlas-ui/ai/file-tree'

import { ROOT_DIRECTORY, orderedEntries, pathWithin, type TreeEntry } from './file-tree-source'

export type DirectoryListings = ReadonlyMap<string, readonly TreeEntry[]>

type Decoration = {
  changes: ReadonlyMap<string, EFileChange>
  ignored: ReadonlySet<string>
}

const isWithin = (args: { directory: string; path: string }): boolean =>
  args.directory === ROOT_DIRECTORY || args.path.startsWith(`${args.directory}/`)

const childNameOf = (args: { directory: string; path: string }): string =>
  (args.directory === ROOT_DIRECTORY
    ? args.path
    : args.path.slice(args.directory.length + 1)
  ).split('/')[0] ?? ''

function deletedEntriesUnder(args: {
  directory: string
  listed: readonly TreeEntry[]
  changes: ReadonlyMap<string, EFileChange>
}): TreeEntry[] {
  const present = new Set(args.listed.map((entry) => entry.name))
  const missing = new Map<string, TreeEntry>()
  for (const [path, change] of args.changes) {
    if (change !== EFileChange.Deleted || !isWithin({ directory: args.directory, path })) continue
    const name = childNameOf({ directory: args.directory, path })
    if (name === '' || present.has(name)) continue
    const isDirectory = pathWithin({ directory: args.directory, name }) !== path
    missing.set(name, { name, isDirectory })
  }
  return [...missing.values()]
}

export function folderChangeOf(args: {
  directory: string
  changes: ReadonlyMap<string, EFileChange>
}): EFileChange | undefined {
  const kinds = new Set<EFileChange>()
  for (const [path, change] of args.changes) {
    if (isWithin({ directory: args.directory, path })) kinds.add(change)
  }
  if (kinds.size === 0) return undefined
  if (kinds.size === 1) return [...kinds][0]
  return EFileChange.Modified
}

const isIgnored = (args: { path: string; ignored: ReadonlySet<string> }): boolean => {
  const segments = args.path.split('/')
  return segments.some((_, index) => args.ignored.has(segments.slice(0, index + 1).join('/')))
}

const decorated = (args: {
  node: FileNode
  change: EFileChange | undefined
  ignored: boolean
}): FileNode => ({
  ...args.node,
  ...(args.change === undefined ? {} : { change: args.change }),
  ...(args.ignored && args.change === undefined ? { ignored: true } : {}),
})

export function nodesOf(
  args: {
    listings: DirectoryListings
    directory?: string
  } & Decoration,
): FileNode[] {
  const directory = args.directory ?? ROOT_DIRECTORY
  const listed = args.listings.get(directory) ?? []
  if (directory === ROOT_DIRECTORY && !args.listings.has(ROOT_DIRECTORY)) return []
  const deleted = deletedEntriesUnder({
    directory,
    listed,
    changes: args.changes,
  })
  const entries = deleted.length === 0 ? listed : orderedEntries([...listed, ...deleted])

  return entries.map((entry): FileNode => {
    const path = pathWithin({ directory, name: entry.name })
    const ignored = isIgnored({ path, ignored: args.ignored })
    if (entry.isDirectory) {
      const loaded = args.listings.has(path)
      return decorated({
        node: {
          path,
          name: entry.name,
          children: nodesOf({ ...args, directory: path }),
          ...(loaded ? {} : { loaded: false }),
        },
        change: folderChangeOf({ directory: path, changes: args.changes }),
        ignored,
      })
    }
    return decorated({
      node: { path, name: entry.name },
      change: args.changes.get(path),
      ignored,
    })
  })
}
