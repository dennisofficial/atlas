import type { DirectoryEntry } from '@dltech/atlas-core'

import type { LoadedFile } from './file-browser'
import type { MentionReader } from './mention-reader'

export const MENTION_FILES_CONNECTING =
  'the cloud filesystem is still connecting; try again once the session is connected'

export class UnavailableMentionFiles implements MentionReader {
  list(_directory: string): Promise<readonly DirectoryEntry[]> {
    return Promise.reject(new Error(MENTION_FILES_CONNECTING))
  }

  exists(_path: string): Promise<boolean> {
    return Promise.reject(new Error(MENTION_FILES_CONNECTING))
  }

  load(_path: string): Promise<LoadedFile> {
    return Promise.reject(new Error(MENTION_FILES_CONNECTING))
  }

  forget(): void {}
}
