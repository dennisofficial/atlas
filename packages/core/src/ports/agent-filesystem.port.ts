import type { ThreadId } from '../events/ids'
import type { FileStat, FileSystemEntry } from './filesystem.port'

export abstract class AgentFileSystemPort {
  abstract stat(args: { path: string; threadId?: ThreadId | undefined }): Promise<FileStat>

  /** Leaf symlink target (relative links unresolved), or null when the path is not a symlink. */
  abstract readLink(args: {
    path: string
    threadId?: ThreadId | undefined
  }): Promise<string | null>

  abstract readFile(args: { path: string; threadId?: ThreadId | undefined }): Promise<string>

  abstract readBytes(args: { path: string; threadId?: ThreadId | undefined }): Promise<Uint8Array>

  abstract writeFile(args: {
    path: string
    content: string
    mode?: number | undefined
    threadId?: ThreadId | undefined
  }): Promise<void>

  abstract removeFile(args: { path: string; threadId?: ThreadId | undefined }): Promise<void>

  abstract mkdir(args: { path: string; threadId?: ThreadId | undefined }): Promise<void>

  abstract rename(args: {
    from: string
    to: string
    threadId?: ThreadId | undefined
  }): Promise<void>

  abstract readDirectory(args: {
    path: string
    threadId?: ThreadId | undefined
  }): Promise<readonly FileSystemEntry[]>

  abstract glob(args: {
    pattern: string
    cwd: string
    dot?: boolean | undefined
    signal?: AbortSignal | undefined
    threadId?: ThreadId | undefined
  }): Promise<readonly string[]>
}
