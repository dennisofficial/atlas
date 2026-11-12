import { describe, expect, it } from 'bun:test'

import type { FileStat, FileSystemEntry, ProcessHandle, SpawnCommand } from '@dltech/atlas-core'
import { FileSystemPort, ProcessPort } from '@dltech/atlas-core'

import { EProjectFileState } from '../project-files'
import { writeProjectFiles } from '../project-file-writer'
import { RecordingProcessPort } from './workspace-fakes'

class RecordingFileSystemPort extends FileSystemPort {
  readonly written: { path: string; content: string; mode: number | undefined }[] = []

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

  override writeFile(args: { path: string; content: string; mode?: number }): Promise<void> {
    this.written.push({ path: args.path, content: args.content, mode: args.mode })
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

class GitProcessPort extends ProcessPort {
  readonly spawned: string[][] = []

  constructor(private readonly exitCodeOf: (cmd: readonly string[]) => number) {
    super()
  }

  override spawn(args: SpawnCommand): ProcessHandle {
    this.spawned.push([...args.cmd])
    const stdout = args.cmd.includes('--git-path') ? '/repo/.git/info/exclude' : ''
    return {
      stdout: new ReadableStream<Uint8Array>({
        start: (sink) => {
          sink.enqueue(new TextEncoder().encode(stdout))
          sink.close()
        },
      }),
      stderr: new ReadableStream<Uint8Array>({ start: (sink) => sink.close() }),
      exited: Promise.resolve(this.exitCodeOf(args.cmd)),
      terminate: () => {},
    }
  }

  override which(): string | null {
    return null
  }
}

const roots = { repositoryDir: '/repo', home: '/home/user', atlasHome: '/atlas/home' }

const processesSaying = (exitCodeOf: (cmd: readonly string[]) => number): RecordingProcessPort =>
  new RecordingProcessPort({ exitCodeOf: (args) => exitCodeOf(args.cmd) })

describe('writeProjectFiles', () => {
  it('writes an untracked, unignored file and adds it to the exclude file', async () => {
    const files = new RecordingFileSystemPort()
    const processes = new GitProcessPort((cmd) =>
      cmd.includes('--is-inside-work-tree') || cmd.includes('--git-path') ? 0 : 1,
    )

    const outcomes = await writeProjectFiles({
      mounts: [{ path: 'apps/api/.env.keys', contents: 'KEY=1', mode: 0o600 }],
      files,
      processes,
      roots,
    })

    expect(outcomes).toEqual([
      { path: 'apps/api/.env.keys', state: EProjectFileState.WrittenLocallyExcluded },
    ])
    expect(files.written).toEqual([
      { path: '/repo/apps/api/.env.keys', content: 'KEY=1', mode: 0o600 },
      {
        path: '/repo/.git/info/exclude',
        content: '/apps/api/.env.keys\n',
        mode: undefined,
      },
    ])
  })

  it('leaves a tracked file alone', async () => {
    const files = new RecordingFileSystemPort()
    const processes = processesSaying((cmd) => (cmd.includes('rev-parse') ? 0 : 0))

    const outcomes = await writeProjectFiles({
      mounts: [{ path: 'README.md', contents: 'KEY=1', mode: 0o600 }],
      files,
      processes,
      roots,
    })

    expect(outcomes).toEqual([{ path: 'README.md', state: EProjectFileState.SkippedTracked }])
    expect(files.written).toEqual([])
  })

  it('writes an ignored file without touching the exclude file', async () => {
    const files = new RecordingFileSystemPort()
    const processes = processesSaying((cmd) =>
      cmd.includes('rev-parse') ? 0 : cmd.includes('ls-files') ? 1 : 0,
    )

    const outcomes = await writeProjectFiles({
      mounts: [{ path: '.env', contents: 'KEY=1', mode: 0o600 }],
      files,
      processes,
      roots,
    })

    expect(outcomes).toEqual([{ path: '.env', state: EProjectFileState.Written }])
  })

  it('writes a home file without asking git', async () => {
    const files = new RecordingFileSystemPort()
    const processes = processesSaying(() => 0)

    const outcomes = await writeProjectFiles({
      mounts: [{ path: '~/notes.md', contents: 'x', mode: 0o600 }],
      files,
      processes,
      roots,
    })

    expect(outcomes).toEqual([{ path: '~/notes.md', state: EProjectFileState.Written }])
    expect(processes.spawned).toEqual([])
  })

  it('skips every repository mount when the launch directory is not a work tree', async () => {
    const files = new RecordingFileSystemPort()
    const processes = processesSaying(() => 1)

    const outcomes = await writeProjectFiles({
      mounts: [{ path: '.env.keys', contents: 'x', mode: 0o600 }],
      files,
      processes,
      roots,
    })

    expect(outcomes).toEqual([{ path: '.env.keys', state: EProjectFileState.SkippedNoRepository }])
  })
})
