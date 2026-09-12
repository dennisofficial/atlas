import { describe, expect, it } from 'bun:test'

import {
  toThreadId,
  type FileSystemPort,
  type ProcessHandle,
  type ProcessPort,
  type SpawnCommand,
} from '@dltech/atlas-core'

import { runPosixGrep, type SearchResult } from '../grep-fallback'

const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })

class FakeProcesses implements ProcessPort {
  readonly spawned: SpawnCommand[] = []
  readonly terminated: SpawnCommand[] = []

  constructor(private readonly onSpawn?: (handle: { terminate: () => void }) => void) {}

  which(): string | null {
    return null
  }

  spawn(args: SpawnCommand): ProcessHandle {
    this.spawned.push(args)
    const handle: ProcessHandle = {
      stdout: streamOf(''),
      stderr: streamOf(''),
      exited: Promise.resolve(0),
      terminate: () => {
        this.terminated.push(args)
      },
    }
    this.onSpawn?.(handle)
    return handle
  }
}

const fakeFiles = (entries: readonly string[], stat?: FileSystemPort['stat']): FileSystemPort => ({
  stat: stat ?? (async () => {
    throw new Error('ENOENT')
  }),
  readLink: async () => null,
  readFile: async () => {
    throw new Error('ENOENT')
  },
  readBytes: async () => {
    throw new Error('ENOENT')
  },
  writeFile: async () => undefined,
  removeFile: async () => undefined,
  mkdir: async () => undefined,
  rename: async () => undefined,
  readDirectory: async () => [],
  glob: async () => entries,
})

const searchWith = (args: {
  processes: FakeProcesses
  files: FileSystemPort
  signal: AbortSignal
}): Promise<SearchResult> =>
  runPosixGrep({
    pattern: 'needle',
    searchPath: '/work',
    cwd: '/work',
    include: undefined,
    excludeSegments: [],
    caseInsensitive: false,
    context: undefined,
    signal: args.signal,
    processes: args.processes,
    files: args.files,
    threadId: toThreadId('thread-1'),
  })

describe('runPosixGrep under an abort signal', () => {
  it('spawns no grep at all when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const processes = new FakeProcesses()

    await searchWith({ processes, files: fakeFiles(['/work/a.ts']), signal: controller.signal })

    expect(processes.spawned).toHaveLength(0)
  })

  it('terminates a search spawned over a single file when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const processes = new FakeProcesses()
    const files = fakeFiles([], async () => ({
      size: 1,
      mode: 0o100644,
      mtimeMs: 0,
      isFile: () => true,
      isDirectory: () => false,
    }))

    await searchWith({ processes, files, signal: controller.signal })

    expect(processes.spawned).toHaveLength(1)
    expect(processes.terminated).toHaveLength(1)
  })

  it('stops spawning further batches once the signal aborts mid-search', async () => {
    const controller = new AbortController()
    const processes = new FakeProcesses(() => controller.abort())
    const entries = Array.from({ length: 130 }, (_, index) => `/work/file-${index}.ts`)

    await searchWith({ processes, files: fakeFiles(entries), signal: controller.signal })

    expect(processes.spawned).toHaveLength(1)
    expect(processes.terminated).toHaveLength(1)
  })
})
