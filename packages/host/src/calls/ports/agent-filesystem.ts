import {
  AgentFileSystemPort,
  type FileStat,
  type FileSystemEntry,
  type ThreadId,
} from '@dltech/atlas-core'

import { DaemonFileSystemPort, type DaemonFileSystemArgs } from './filesystem'

export class DaemonAgentFileSystemPort extends AgentFileSystemPort {
  private readonly files: DaemonFileSystemPort

  constructor(args: DaemonFileSystemArgs) {
    super()
    this.files = new DaemonFileSystemPort(args)
  }

  stat(args: { path: string; threadId?: ThreadId | undefined }): Promise<FileStat> {
    return this.files.stat(args)
  }

  readLink(args: { path: string; threadId?: ThreadId | undefined }): Promise<string | null> {
    return this.files.readLink(args)
  }

  readFile(args: { path: string; threadId?: ThreadId | undefined }): Promise<string> {
    return this.files.readFile(args)
  }

  readBytes(args: { path: string; threadId?: ThreadId | undefined }): Promise<Uint8Array> {
    return this.files.readBytes(args)
  }

  readTextForEdit(args: {
    path: string
    threadId?: ThreadId | undefined
  }): Promise<{ text: string; strict: string | null }> {
    return this.files.readTextForEdit(args)
  }

  writeFile(args: {
    path: string
    content: string
    mode?: number | undefined
    threadId?: ThreadId | undefined
  }): Promise<void> {
    return this.files.writeFile({
      path: args.path,
      content: args.content,
      ...(args.mode === undefined ? {} : { mode: args.mode }),
    })
  }

  removeFile(args: { path: string; threadId?: ThreadId | undefined }): Promise<void> {
    return this.files.removeFile(args)
  }

  mkdir(args: { path: string; threadId?: ThreadId | undefined }): Promise<void> {
    return this.files.mkdir(args)
  }

  rename(args: { from: string; to: string; threadId?: ThreadId | undefined }): Promise<void> {
    return this.files.rename(args)
  }

  readDirectory(args: {
    path: string
    threadId?: ThreadId | undefined
  }): Promise<readonly FileSystemEntry[]> {
    return this.files.readDirectory(args)
  }

  glob(args: {
    pattern: string
    cwd: string
    dot?: boolean | undefined
    signal?: AbortSignal | undefined
    threadId?: ThreadId | undefined
  }): Promise<readonly string[]> {
    return this.files.glob({
      pattern: args.pattern,
      cwd: args.cwd,
      ...(args.dot === undefined ? {} : { dot: args.dot }),
      ...(args.signal === undefined ? {} : { signal: args.signal }),
    })
  }
}
