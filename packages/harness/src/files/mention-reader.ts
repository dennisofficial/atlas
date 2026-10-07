import type { DirectoryEntry } from '@dltech/atlas-core'

import type { LoadedFile } from './file-browser'

export type MentionReader = {
  list(directory: string): Promise<readonly DirectoryEntry[]>
  exists(path: string): Promise<boolean>
  load(path: string): Promise<LoadedFile>
  forget(): void
}
