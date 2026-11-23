import { EFilesRoot } from '@dltech/atlas-protocol'

import { v2FileSource } from '@/features/threads/data/file-source'
import type { TreeEntry } from '@/features/threads/data/file-tree-source'

export const contextDirectoryKey = (args: { sessionId: string; directory: string }) =>
  ['v2-context-directory', args.sessionId, args.directory] as const

export const fetchContextDirectory = (args: {
  sessionId: string
  directory: string
}): Promise<TreeEntry[]> =>
  v2FileSource({ sessionId: args.sessionId, root: EFilesRoot.Context }).browse({
    directory: args.directory,
  })
