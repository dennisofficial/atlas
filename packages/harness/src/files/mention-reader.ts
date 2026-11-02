import type { DirectoryEntry } from '@dltech/atlas-core'

import type { LoadedFile, ViewedFile } from './file-browser'

export type MentionReader = {
  list(directory: string): Promise<readonly DirectoryEntry[]>
  exists(path: string): Promise<boolean>
  load(path: string): Promise<LoadedFile>
  read(path: string): Promise<ViewedFile>
  forget(): void
}
