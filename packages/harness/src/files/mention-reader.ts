import type { DirectoryEntry } from '@dltech/atlas-core'

import type { FileSearchResult, LoadedFile, ViewedFile } from './file-browser'

export type MentionReader = {
  list(directory: string): Promise<readonly DirectoryEntry[]>
  exists(path: string): Promise<boolean>
  load(path: string): Promise<LoadedFile>
  read(path: string): Promise<ViewedFile>
  search(args: { query: string; limit: number }): Promise<FileSearchResult>
  forget(): void
}
