import {
  AgentFileSystemPort,
  EExecutionLocation,
  type FileStat,
  type FileSystemEntry,
  type ThreadId,
} from '@dltech/atlas-core'

export class RoutedFileSystemPort extends AgentFileSystemPort {
  private readonly local: AgentFileSystemPort
  private readonly dockerFor: () => AgentFileSystemPort
  private readonly locationOf: (threadId: ThreadId | undefined) => EExecutionLocation | undefined
  private docker: AgentFileSystemPort | undefined

  constructor(args: {
    local: AgentFileSystemPort
    dockerFor: () => AgentFileSystemPort
    locationOf: (threadId: ThreadId | undefined) => EExecutionLocation | undefined
  }) {
    super()
    this.local = args.local
    this.dockerFor = args.dockerFor
    this.locationOf = args.locationOf
  }

  stat(args: { path: string; threadId?: ThreadId | undefined }): Promise<FileStat> {
    return this.portFor(args.threadId).stat(args)
  }

  readLink(args: { path: string; threadId?: ThreadId | undefined }): Promise<string | null> {
    return this.portFor(args.threadId).readLink(args)
  }

  readFile(args: { path: string; threadId?: ThreadId | undefined }): Promise<string> {
    return this.portFor(args.threadId).readFile(args)
  }

  readBytes(args: { path: string; threadId?: ThreadId | undefined }): Promise<Uint8Array> {
    return this.portFor(args.threadId).readBytes(args)
  }

  writeFile(args: {
    path: string
    content: string
    mode?: number | undefined
    threadId?: ThreadId | undefined
  }): Promise<void> {
    return this.portFor(args.threadId).writeFile(args)
  }

  removeFile(args: { path: string; threadId?: ThreadId | undefined }): Promise<void> {
    return this.portFor(args.threadId).removeFile(args)
  }

  mkdir(args: { path: string; threadId?: ThreadId | undefined }): Promise<void> {
    return this.portFor(args.threadId).mkdir(args)
  }

  rename(args: {
    from: string
    to: string
    threadId?: ThreadId | undefined
  }): Promise<void> {
    return this.portFor(args.threadId).rename(args)
  }

  readDirectory(args: {
    path: string
    threadId?: ThreadId | undefined
  }): Promise<readonly FileSystemEntry[]> {
    return this.portFor(args.threadId).readDirectory(args)
  }

  glob(args: {
    pattern: string
    cwd: string
    dot?: boolean | undefined
    signal?: AbortSignal | undefined
    threadId?: ThreadId | undefined
  }): Promise<readonly string[]> {
    return this.portFor(args.threadId).glob(args)
  }

  private portFor(threadId: ThreadId | undefined): AgentFileSystemPort {
    if (this.locationOf(threadId) !== EExecutionLocation.Docker) return this.local

    this.docker ??= this.dockerFor()
    return this.docker
  }
}
