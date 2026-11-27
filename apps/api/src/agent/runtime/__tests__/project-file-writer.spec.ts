import { describe, expect, it } from 'bun:test'

import {
  FileSystemPort,
  ProcessPort,
  type FileStat,
  type FileSystemEntry,
  type ProcessHandle,
  type SpawnCommand,
} from '@dltech/atlas-core'

import { EProjectFileState } from '../project-files'
import { writeProjectFiles } from '../project-file-writer'

class RecordingFileSystemPort extends FileSystemPort {
  readonly contents = new Map<string, string>()
  readonly modes = new Map<string, number | undefined>()
  readonly writes: { path: string; content: string; mode: number | undefined }[] = []
  readonly renames: { from: string; to: string }[] = []

  override stat(): Promise<FileStat> {
    return Promise.reject(new Error('missing'))
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

  override readTextForEdit(): Promise<{ text: string; strict: string | null }> {
    return Promise.reject(new Error('missing'))
  }

  override writeFile(args: {
    path: string
    content: string | Uint8Array
    mode?: number | undefined
  }): Promise<void> {
    const content =
      typeof args.content === 'string' ? args.content : new TextDecoder().decode(args.content)
    this.contents.set(args.path, content)
    this.modes.set(args.path, args.mode)
    this.writes.push({ path: args.path, content, mode: args.mode })
    return Promise.resolve()
  }

  override removeFile(args: { path: string }): Promise<void> {
    this.contents.delete(args.path)
    this.modes.delete(args.path)
    return Promise.resolve()
  }

  override mkdir(): Promise<void> {
    return Promise.resolve()
  }

  override rename(args: { from: string; to: string }): Promise<void> {
    const content = this.contents.get(args.from)
    if (content === undefined) return Promise.reject(new Error(`missing ${args.from}`))
    this.contents.delete(args.from)
    this.contents.set(args.to, content)
    this.modes.set(args.to, this.modes.get(args.from))
    this.modes.delete(args.from)
    this.renames.push(args)
    return Promise.resolve()
  }

  override readDirectory(): Promise<readonly FileSystemEntry[]> {
    return Promise.resolve([])
  }

  override glob(): Promise<readonly string[]> {
    return Promise.resolve([])
  }
}

type GitRepo = {
  inWorkTree?: boolean
  tracked?: readonly string[]
  ignored?: readonly string[]
  failing?: 'ls-files' | 'check-ignore'
}

const pathsAfterDashes = (cmd: readonly string[]): string[] => cmd.slice(cmd.indexOf('--') + 1)

class GitProcessPort extends ProcessPort {
  readonly spawned: string[][] = []

  constructor(private readonly repo: GitRepo = {}) {
    super()
  }

  override spawn(args: SpawnCommand): ProcessHandle {
    this.spawned.push([...args.cmd])
    const { code, stdout } = this.answer(args.cmd)
    return {
      stdout: new ReadableStream<Uint8Array>({
        start: (sink) => {
          sink.enqueue(new TextEncoder().encode(stdout))
          sink.close()
        },
      }),
      stderr: new ReadableStream<Uint8Array>({ start: (sink) => sink.close() }),
      exited: Promise.resolve(code),
      terminate: () => {},
    }
  }

  override which(): string | null {
    return null
  }

  private answer(cmd: readonly string[]): { code: number; stdout: string } {
    if (this.repo.inWorkTree === false) return { code: 128, stdout: '' }
    if (cmd.includes('--is-inside-work-tree')) return { code: 0, stdout: 'true\n' }
    if (cmd.includes('--git-path')) return { code: 0, stdout: '.git/info/exclude\n' }
    if (cmd.includes('ls-files')) {
      if (this.repo.failing === 'ls-files') return { code: 128, stdout: '' }
      const asked = pathsAfterDashes(cmd)
      const hits = (this.repo.tracked ?? []).filter((entry) =>
        asked.some((path) => entry === path || entry.startsWith(`${path}/`)),
      )
      return { code: 0, stdout: hits.map((path) => `${path}\0`).join('') }
    }
    if (this.repo.failing === 'check-ignore') return { code: 128, stdout: '' }
    const hits = cmd.slice(4).filter((path) => this.repo.ignored?.includes(path))
    return { code: hits.length === 0 ? 1 : 0, stdout: hits.map((path) => `${path}\0`).join('') }
  }
}

const roots = { repositoryDir: '/repo', home: '/home/user', atlasHome: '/atlas/home' }

describe('writeProjectFiles', () => {
  it('writes an untracked, unignored file with its mode and excludes it locally', async () => {
    const files = new RecordingFileSystemPort()
    const processes = new GitProcessPort()

    const outcomes = await writeProjectFiles({
      mounts: [{ path: 'apps/api/.env.keys', contents: 'KEY=1', mode: 0o600 }],
      files,
      processes,
      roots,
    })

    expect(outcomes).toEqual([
      { path: 'apps/api/.env.keys', state: EProjectFileState.WrittenLocallyExcluded },
    ])
    expect(files.contents.get('/repo/apps/api/.env.keys')).toBe('KEY=1')
    expect(files.modes.get('/repo/apps/api/.env.keys')).toBe(0o600)
    expect(files.renames).toHaveLength(1)
    expect(files.renames[0]?.from.startsWith('/repo/apps/api/.atlas-')).toBe(true)
    expect(files.renames[0]?.from.endsWith('.tmp')).toBe(true)
    expect(files.renames[0]?.to).toBe('/repo/apps/api/.env.keys')
    expect(files.contents.get('/repo/.git/info/exclude')).toBe('/apps/api/.env.keys\n')
  })

  it('keeps a wider mode than the staged file', async () => {
    const files = new RecordingFileSystemPort()
    const processes = new GitProcessPort()

    await writeProjectFiles({
      mounts: [{ path: '.env', contents: 'KEY=1', mode: 0o644 }],
      files,
      processes,
      roots,
    })

    expect(files.modes.get('/repo/.env')).toBe(0o644)
  })

  it('appends to an existing exclude file once', async () => {
    const files = new RecordingFileSystemPort()
    files.contents.set('/repo/.git/info/exclude', '/.env\n')
    const processes = new GitProcessPort()

    await writeProjectFiles({
      mounts: [{ path: '.env.keys', contents: 'KEY=1', mode: 0o600 }],
      files,
      processes,
      roots,
    })

    expect(files.contents.get('/repo/.git/info/exclude')).toBe('/.env\n/.env.keys\n')
  })

  it('leaves a tracked file alone', async () => {
    const files = new RecordingFileSystemPort()
    const processes = new GitProcessPort({ tracked: ['README.md'] })

    const outcomes = await writeProjectFiles({
      mounts: [{ path: 'README.md', contents: 'KEY=1', mode: 0o600 }],
      files,
      processes,
      roots,
    })

    expect(outcomes).toEqual([{ path: 'README.md', state: EProjectFileState.SkippedTracked }])
    expect(files.writes).toEqual([])
  })

  it('writes an ignored file without touching the exclude file', async () => {
    const files = new RecordingFileSystemPort()
    const processes = new GitProcessPort({ ignored: ['.env'] })

    const outcomes = await writeProjectFiles({
      mounts: [{ path: '.env', contents: 'KEY=1', mode: 0o600 }],
      files,
      processes,
      roots,
    })

    expect(outcomes).toEqual([{ path: '.env', state: EProjectFileState.Written }])
    expect(files.contents.get('/repo/.env')).toBe('KEY=1')
    expect(files.contents.has('/repo/.git/info/exclude')).toBe(false)
  })

  it('writes a home file without asking git', async () => {
    const files = new RecordingFileSystemPort()
    const processes = new GitProcessPort()

    const outcomes = await writeProjectFiles({
      mounts: [{ path: '~/notes.md', contents: 'x', mode: 0o600 }],
      files,
      processes,
      roots,
    })

    expect(outcomes).toEqual([{ path: '~/notes.md', state: EProjectFileState.Written }])
    expect(files.contents.get('/home/user/notes.md')).toBe('x')
    expect(processes.spawned).toEqual([])
  })

  it('skips every repository mount when the launch directory is not a work tree', async () => {
    const files = new RecordingFileSystemPort()
    const processes = new GitProcessPort({ inWorkTree: false })

    const outcomes = await writeProjectFiles({
      mounts: [{ path: '.env.keys', contents: 'x', mode: 0o600 }],
      files,
      processes,
      roots,
    })

    expect(outcomes).toEqual([{ path: '.env.keys', state: EProjectFileState.SkippedNoRepository }])
    expect(files.writes).toEqual([])
  })

  it('asks git once per repository however many files it mounts', async () => {
    const files = new RecordingFileSystemPort()
    const processes = new GitProcessPort({ ignored: ['apps/api/.env.keys'] })

    const outcomes = await writeProjectFiles({
      mounts: [
        { path: 'apps/api/.env.keys', contents: 'A=1', mode: 0o600 },
        { path: 'apps/trigger/.env.keys', contents: 'B=1', mode: 0o600 },
        { path: 'scripts/.env.keys', contents: 'C=1', mode: 0o600 },
      ],
      files,
      processes,
      roots,
    })

    expect(processes.spawned).toHaveLength(4)
    expect(outcomes).toEqual([
      { path: 'apps/api/.env.keys', state: EProjectFileState.Written },
      { path: 'apps/trigger/.env.keys', state: EProjectFileState.WrittenLocallyExcluded },
      { path: 'scripts/.env.keys', state: EProjectFileState.WrittenLocallyExcluded },
    ])
    expect(files.contents.get('/repo/.git/info/exclude')).toBe(
      '/apps/trigger/.env.keys\n/scripts/.env.keys\n',
    )
    expect(files.writes.filter((write) => write.path.endsWith('exclude'))).toHaveLength(1)
  })

  it('leaves a path alone when git tracks files beneath it', async () => {
    const files = new RecordingFileSystemPort()
    const processes = new GitProcessPort({ tracked: ['config/app.json'] })

    const outcomes = await writeProjectFiles({
      mounts: [{ path: 'config', contents: 'x', mode: 0o600 }],
      files,
      processes,
      roots,
    })

    expect(outcomes).toEqual([{ path: 'config', state: EProjectFileState.SkippedTracked }])
    expect(files.writes).toEqual([])
  })

  it('fails a mount without writing it when git cannot check it', async () => {
    const files = new RecordingFileSystemPort()
    const processes = new GitProcessPort({ failing: 'check-ignore' })

    const outcomes = await writeProjectFiles({
      mounts: [{ path: '.env', contents: 'x', mode: 0o600 }],
      files,
      processes,
      roots,
    })

    expect(outcomes).toEqual([
      {
        path: '.env',
        state: EProjectFileState.Failed,
        reason: 'git could not check whether the path is ignored',
      },
    ])
    expect(files.writes).toEqual([])
  })
})
