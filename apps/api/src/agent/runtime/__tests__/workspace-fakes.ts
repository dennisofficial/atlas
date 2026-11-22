import {
  FileSystemPort,
  ProcessPort,
  type FileStat,
  type FileSystemEntry,
  type ProcessHandle,
  type ProcessOutcome,
  type SpawnCommand,
} from '@dltech/atlas-core'

export class RecordingProcessPort extends ProcessPort {
  readonly spawned: SpawnCommand[] = []

  constructor(
    private readonly script: {
      chunks?: readonly string[]
      exitCodeOf?: (args: SpawnCommand) => number
      outcomeOf?: (args: SpawnCommand) => ProcessOutcome | undefined
    } = {},
  ) {
    super()
  }

  override spawn(args: SpawnCommand): ProcessHandle {
    this.spawned.push(args)
    const encoder = new TextEncoder()
    const chunks = args.cmd[0] === 'sh' ? (this.script.chunks ?? []) : []
    const outcome = this.script.outcomeOf?.(args)
    return {
      stdout: new ReadableStream<Uint8Array>({
        start: (sink) => {
          for (const chunk of chunks) sink.enqueue(encoder.encode(chunk))
          sink.close()
        },
      }),
      stderr: new ReadableStream<Uint8Array>({ start: (sink) => sink.close() }),
      exited: Promise.resolve(this.script.exitCodeOf?.(args) ?? 0),
      ...(outcome === undefined ? {} : { outcome: Promise.resolve(outcome) }),
      terminate: () => {},
    }
  }

  override which(): string | null {
    return null
  }
}

export class StubFileSystemPort extends FileSystemPort {
  readonly contents = new Map<string, string>()
  readonly directories = new Set<string>()

  override stat(args: { path: string }): Promise<FileStat> {
    const content = this.contents.get(args.path)
    const directory = this.directories.has(args.path)
    if (content === undefined && !directory) return Promise.reject(new Error('missing'))
    return Promise.resolve({
      size: content?.length ?? 0,
      mode: 0o644,
      mtimeMs: 0,
      isFile: () => !directory,
      isDirectory: () => directory,
    })
  }

  override readLink(): Promise<string | null> {
    return Promise.resolve(null)
  }

  override readFile(args: { path: string }): Promise<string> {
    const content = this.contents.get(args.path)
    return content === undefined
      ? Promise.reject(new Error(`missing ${args.path}`))
      : Promise.resolve(content)
  }

  override readBytes(args: { path: string }): Promise<Uint8Array> {
    return this.readFile(args).then((text) => new TextEncoder().encode(text))
  }

  override readTextForEdit(args: {
    path: string
  }): Promise<{ text: string; strict: string | null }> {
    return this.readFile(args).then((text) => ({ text, strict: text }))
  }

  override writeFile(args: { path: string; content: string | Uint8Array }): Promise<void> {
    this.contents.set(
      args.path,
      typeof args.content === 'string' ? args.content : new TextDecoder().decode(args.content),
    )
    return Promise.resolve()
  }

  override removeFile(args: { path: string }): Promise<void> {
    this.contents.delete(args.path)
    this.directories.delete(args.path)
    return Promise.resolve()
  }

  override mkdir(args: { path: string }): Promise<void> {
    this.directories.add(args.path)
    return Promise.resolve()
  }

  override rename(args: { from: string; to: string }): Promise<void> {
    const content = this.contents.get(args.from)
    if (content !== undefined) {
      this.contents.delete(args.from)
      this.contents.set(args.to, content)
      return Promise.resolve()
    }
    if (this.directories.delete(args.from)) {
      this.directories.add(args.to)
      return Promise.resolve()
    }
    return Promise.reject(new Error(`missing ${args.from}`))
  }

  override readDirectory(): Promise<readonly FileSystemEntry[]> {
    return Promise.resolve([])
  }

  override glob(): Promise<readonly string[]> {
    return Promise.resolve([])
  }
}

const CLONED_REPO = /github\.com[/:]([^/]+\/[^/.\s]+)/

const clonedRepoOf = (cmd: readonly string[]): string | null => {
  if (!cmd.includes('clone')) return null
  for (const part of cmd) {
    const match = CLONED_REPO.exec(part)
    if (match?.[1] !== undefined) return match[1]
  }
  return null
}

export class GatedClones extends ProcessPort {
  readonly spawned: SpawnCommand[] = []
  readonly terminated: string[] = []
  maxInFlight = 0
  private inFlight = 0
  private readonly waiting: Array<() => void> = []

  constructor(private readonly gate: { expected: number; failing?: string }) {
    super()
  }

  override spawn(args: SpawnCommand): ProcessHandle {
    this.spawned.push(args)
    const repo = clonedRepoOf(args.cmd)
    let finish: (code: number) => void = () => {}
    const exited = new Promise<number>((resolve) => {
      finish = resolve
    })
    if (repo === null) finish(0)
    else this.hold({ repo, finish })
    return {
      stdout: new ReadableStream<Uint8Array>({
        start: (sink) => {
          void exited.then(() => sink.close())
        },
      }),
      stderr: new ReadableStream<Uint8Array>({ start: (sink) => sink.close() }),
      exited,
      terminate: () => {
        if (repo !== null) this.terminated.push(repo)
        finish(143)
      },
    }
  }

  override which(): string | null {
    return null
  }

  private hold(args: { repo: string; finish: (code: number) => void }): void {
    this.inFlight += 1
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight)
    const release = (): void => {
      if (args.repo === this.gate.failing) args.finish(1)
      else if (this.gate.failing === undefined) args.finish(0)
    }
    this.waiting.push(release)
    if (this.inFlight < this.gate.expected) return
    for (const open of this.waiting.splice(0)) open()
  }
}
