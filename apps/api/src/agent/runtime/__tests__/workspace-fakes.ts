import {
  FileSystemPort,
  ProcessPort,
  type FileStat,
  type FileSystemEntry,
  type ProcessHandle,
  type SpawnCommand,
} from '@dltech/atlas-core'

export class RecordingProcessPort extends ProcessPort {
  readonly spawned: SpawnCommand[] = []

  constructor(
    private readonly script: {
      chunks?: readonly string[]
      exitCodeOf?: (args: SpawnCommand) => number
    } = {},
  ) {
    super()
  }

  override spawn(args: SpawnCommand): ProcessHandle {
    this.spawned.push(args)
    const encoder = new TextEncoder()
    const chunks = args.cmd[0] === 'sh' ? (this.script.chunks ?? []) : []
    return {
      stdout: new ReadableStream<Uint8Array>({
        start: (sink) => {
          for (const chunk of chunks) sink.enqueue(encoder.encode(chunk))
          sink.close()
        },
      }),
      stderr: new ReadableStream<Uint8Array>({ start: (sink) => sink.close() }),
      exited: Promise.resolve(this.script.exitCodeOf?.(args) ?? 0),
      terminate: () => {},
    }
  }

  override which(): string | null {
    return null
  }
}

export class StubFileSystemPort extends FileSystemPort {
  override stat(): Promise<FileStat> {
    return Promise.reject(new Error('missing'))
  }

  override readLink(): Promise<string | null> {
    return Promise.resolve(null)
  }

  override readFile(): Promise<string> {
    return Promise.reject(new Error('missing'))
  }

  override readBytes(): Promise<Uint8Array> {
    return Promise.reject(new Error('missing'))
  }

  override readTextForEdit(): Promise<{ text: string; strict: string | null }> {
    return Promise.reject(new Error('missing'))
  }

  override writeFile(): Promise<void> {
    return Promise.resolve()
  }

  override removeFile(): Promise<void> {
    return Promise.resolve()
  }

  override mkdir(): Promise<void> {
    return Promise.resolve()
  }

  override rename(): Promise<void> {
    return Promise.resolve()
  }

  override readDirectory(): Promise<readonly FileSystemEntry[]> {
    return Promise.resolve([])
  }

  override glob(): Promise<readonly string[]> {
    return Promise.resolve([])
  }
}
