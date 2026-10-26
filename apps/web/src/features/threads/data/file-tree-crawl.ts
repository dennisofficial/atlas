import {
  ROOT_DIRECTORY,
  browseDirectory,
  pathWithin,
  type FileTreeChannel,
} from './file-tree-source'
import type { TreeEntry } from './file-tree-source'

export const MAX_DIRECTORIES = 400
export const CRAWL_BATCH = 6

export async function crawlDirectories(args: {
  channel: FileTreeChannel
  onListing: (listing: { directory: string; entries: TreeEntry[] }) => void
  isCancelled: () => boolean
  limit?: number
}): Promise<void> {
  const limit = args.limit ?? MAX_DIRECTORIES
  const queue: string[] = [ROOT_DIRECTORY]
  let loaded = 0

  while (queue.length > 0 && loaded < limit && !args.isCancelled()) {
    const batch = queue.splice(0, Math.min(CRAWL_BATCH, limit - loaded))
    loaded += batch.length
    const settled = await Promise.all(
      batch.map(async (directory) => {
        const entries = await browseDirectory({
          channel: args.channel,
          directory,
        }).catch((error: unknown) => {
          if (directory === ROOT_DIRECTORY) throw error
          return null
        })
        return { directory, entries }
      }),
    )
    if (args.isCancelled()) return
    for (const { directory, entries } of settled) {
      if (entries === null) continue
      args.onListing({ directory, entries })
      for (const entry of entries) {
        if (entry.isDirectory) queue.push(pathWithin({ directory, name: entry.name }))
      }
    }
  }
}
