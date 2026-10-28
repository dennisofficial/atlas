import { FileBrowser } from './file-browser'
import type { MentionReader } from './mention-reader'
import { threadProjectDirectory, type ThreadDirectorySources } from './thread-project-directory'

export async function threadMentionFiles(args: ThreadDirectorySources): Promise<MentionReader> {
  return new FileBrowser({ root: await threadProjectDirectory(args) })
}
