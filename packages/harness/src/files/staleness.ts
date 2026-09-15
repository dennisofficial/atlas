import type { AgentFileSystemPort, ThreadId } from '@dltech/atlas-core'

import { digestOf } from './digest'
import type { FileView } from './read-state'

export type FileFacts = { mtimeMs: number; size: number }

export async function movedSince({
  view,
  stats,
  path,
  files,
  threadId,
}: {
  view: FileView
  stats: FileFacts
  path: string
  files?: AgentFileSystemPort | undefined
  threadId?: ThreadId | undefined
}): Promise<boolean> {
  if (view.mtimeMs !== stats.mtimeMs) return true
  if (view.size !== stats.size) return true

  const now = await digestOf({ path, files, threadId })

  return now !== undefined && now !== view.digest
}
