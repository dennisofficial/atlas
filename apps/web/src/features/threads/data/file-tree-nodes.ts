import type { EFileChange, FileNode } from '@dltech/atlas-ui/ai/file-tree'

import { ROOT_DIRECTORY, pathWithin, type TreeEntry } from './file-tree-source'

export type DirectoryListings = ReadonlyMap<string, readonly TreeEntry[]>

export function nodesOf(args: {
  listings: DirectoryListings
  changes: ReadonlyMap<string, EFileChange>
  directory?: string
}): FileNode[] {
  const directory = args.directory ?? ROOT_DIRECTORY
  const entries = args.listings.get(directory) ?? []

  return entries.map((entry): FileNode => {
    const path = pathWithin({ directory, name: entry.name })
    if (entry.isDirectory) {
      return {
        path,
        name: entry.name,
        children: nodesOf({
          listings: args.listings,
          changes: args.changes,
          directory: path,
        }),
      }
    }
    const change = args.changes.get(path)
    return change === undefined ? { path, name: entry.name } : { path, name: entry.name, change }
  })
}
