import { describe, expect, it } from 'bun:test'

import {
  FileSystemPort,
  ProcessPort,
  type FileStat,
  type FileSystemEntry,
  type ProcessHandle,
  type SpawnCommand,
} from '@dltech/atlas-core'

import { HostWorktrees } from '../checkouts'

const LISTING = [
  'worktree /work',
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  'worktree /work/.atlas/worktrees/dennis/wt',
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/dennis/wt',
  '',
  'worktree /work/.atlas/worktrees/dennis/gone',
  'HEAD 3333333333333333333333333333333333333333',
  'detached',
  'prunable mark-worktree-gone',
  '',
].join('\n')

type Answer = { stdout?: string; code?: number }

const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(sink) {
      sink.enqueue(new TextEncoder().encode(text))
      sink.close()
    },
  })

class ScriptedProcesses extends ProcessPort {
  readonly calls: string[] = []

  constructor(private readonly answers: Record<string, Answer>) {
    super()
  }

  spawn(args: SpawnCommand): ProcessHandle {
    const argv = args.cmd.join(' ')
    this.calls.push(argv)
    const answer = this.answers[argv] ?? { code: 1 }
    return {
      stdout: streamOf(answer.stdout ?? ''),
      stderr: streamOf(''),
      exited: Promise.resolve(answer.code ?? 0),
      terminate: () => undefined,
    }
  }

  which(): string | null {
    return null
  }
}

class RecordingFiles extends FileSystemPort {
  readonly written: { path: string; content: string }[] = []
  readonly directories: string[] = []

  async writeFile(args: { path: string; content: string }): Promise<void> {
    this.written.push({ path: args.path, content: args.content })
  }

  async mkdir(args: { path: string }): Promise<void> {
    this.directories.push(args.path)
  }

  async stat(): Promise<FileStat> {
    throw new Error('the checkouts spec reads no stats')
  }

  async readLink(): Promise<string | null> {
    throw new Error('the checkouts spec reads no links')
  }

  async readFile(): Promise<string> {
    throw new Error('the checkouts spec reads no files')
  }

  async readBytes(): Promise<Uint8Array> {
    throw new Error('the checkouts spec reads no bytes')
  }

  async readTextForEdit(): Promise<{ text: string; strict: string | null }> {
    throw new Error('the checkouts spec edits no files')
  }

  async removeFile(): Promise<void> {
    throw new Error('the checkouts spec removes no files')
  }

  async rename(): Promise<void> {
    throw new Error('the checkouts spec renames nothing')
  }

  async readDirectory(): Promise<readonly FileSystemEntry[]> {
    throw new Error('the checkouts spec lists no directories')
  }

  async glob(): Promise<readonly string[]> {
    throw new Error('the checkouts spec globs nothing')
  }
}

const rig = (answers: Record<string, Answer>) => {
  const processes = new ScriptedProcesses(answers)
  const files = new RecordingFiles()
  return { processes, files, worktrees: new HostWorktrees({ processes, files }) }
}

describe('the host worktrees port', () => {
  it('lists the worktrees and names the main checkout as the repository', async () => {
    const { worktrees } = rig({ 'git worktree list --porcelain': { stdout: LISTING } })
    const listing = await worktrees.list({ cwd: '/work/.atlas/worktrees/dennis/wt' })

    expect(listing.repository).toBe('/work')
    expect(listing.worktrees).toEqual([
      {
        path: '/work',
        branch: 'main',
        bare: false,
        detached: false,
        prunable: false,
        isMain: true,
      },
      {
        path: '/work/.atlas/worktrees/dennis/wt',
        branch: 'dennis/wt',
        bare: false,
        detached: false,
        prunable: false,
        isMain: false,
      },
      {
        path: '/work/.atlas/worktrees/dennis/gone',
        branch: null,
        bare: false,
        detached: true,
        prunable: true,
        isMain: false,
      },
    ])
  })

  it('says a directory is not a repository when git refuses to list', async () => {
    const { worktrees } = rig({})
    await expect(worktrees.list({ cwd: '/nowhere' })).rejects.toThrow(
      '/nowhere is not inside a git repository',
    )
  })

  it('creates a branch under .atlas/worktrees, hiding the directory from git', async () => {
    const { worktrees, processes, files } = rig({
      'git worktree list --porcelain': { stdout: LISTING },
      'git fetch origin': { code: 1 },
      'git symbolic-ref --quiet --short refs/remotes/origin/HEAD': { stdout: 'origin/main\n' },
      'git worktree add /work/.atlas/worktrees/dennis/new -b dennis/new origin/main': {
        stdout: '',
      },
    })

    const entry = await worktrees.create({ cwd: '/work', name: 'dennis/new' })

    expect(entry).toEqual({
      path: '/work/.atlas/worktrees/dennis/new',
      branch: 'dennis/new',
      base: 'origin/main',
      staleBase: true,
    })
    expect(files.directories).toEqual(['/work/.atlas/worktrees'])
    expect(files.written).toEqual([{ path: '/work/.atlas/worktrees/.gitignore', content: '*\n' }])
    expect(processes.calls).toContain(
      'git worktree add /work/.atlas/worktrees/dennis/new -b dennis/new origin/main',
    )
  })

  it('refuses with git’s own words when the branch or path already exists', async () => {
    const { worktrees } = rig({
      'git worktree list --porcelain': { stdout: LISTING },
      'git fetch origin': {},
      'git symbolic-ref --quiet --short refs/remotes/origin/HEAD': { stdout: 'origin/main\n' },
      'git worktree add /work/.atlas/worktrees/dennis/wt -b dennis/wt origin/main': {
        stdout: "fatal: a branch named 'dennis/wt' already exists",
        code: 128,
      },
    })

    await expect(worktrees.create({ cwd: '/work', name: 'dennis/wt' })).rejects.toThrow(
      "a branch named 'dennis/wt' already exists",
    )
  })

  it('inspects a worktree through its own checkout', async () => {
    const { worktrees } = rig({
      'git status --porcelain': { stdout: ' M src/a.ts\n?? notes.md\n' },
      'git rev-parse --abbrev-ref --symbolic-full-name @{u}': { stdout: 'origin/dennis/wt\n' },
      'git rev-list --count origin/dennis/wt..HEAD': { stdout: '2\n' },
      'git rev-list --count HEAD..origin/dennis/wt': { stdout: '1\n' },
    })

    const state = await worktrees.inspect({ cwd: '/work/.atlas/worktrees/dennis/wt' })

    expect(state).toEqual({
      isClean: false,
      changedPaths: ['src/a.ts', 'notes.md'],
      changedCount: 2,
      unpushed: { count: 2, against: 'origin/dennis/wt' },
      upstream: 'origin/dennis/wt',
      base: undefined,
      behind: 1,
    })
  })

  it('calls a checkout clean only when nothing changed and nothing is unpushed', async () => {
    const { worktrees } = rig({
      'git status --porcelain': { stdout: '' },
      'git rev-parse --abbrev-ref --symbolic-full-name @{u}': { stdout: 'origin/dennis/wt\n' },
      'git rev-list --count origin/dennis/wt..HEAD': { stdout: '0\n' },
      'git rev-list --count HEAD..origin/dennis/wt': { stdout: '0\n' },
    })

    const state = await worktrees.inspect({ cwd: '/work/.atlas/worktrees/dennis/wt' })

    expect(state.isClean).toBe(true)
    expect(state.unpushed).toEqual({ count: 0, against: 'origin/dennis/wt' })
  })

  it('reports no unpushed count when there is neither an upstream nor a base', async () => {
    const { worktrees } = rig({ 'git status --porcelain': { stdout: '' } })

    const state = await worktrees.inspect({ cwd: '/work/.atlas/worktrees/dennis/wt' })

    expect(state.unpushed).toBeNull()
    expect(state.isClean).toBe(false)
  })

  it('reports no unpushed count when git refuses to count the commits', async () => {
    const { worktrees } = rig({
      'git status --porcelain': { stdout: '' },
      'git rev-list --count origin/main..HEAD': { code: 128 },
    })

    const state = await worktrees.inspect({ cwd: '/work', base: 'origin/main' })

    expect(state.unpushed).toBeNull()
    expect(state.isClean).toBe(false)
  })

  it('reports no unpushed count when git answers with something that is not a number', async () => {
    const { worktrees } = rig({
      'git status --porcelain': { stdout: '' },
      'git rev-list --count origin/main..HEAD': { stdout: 'fatal: bad revision\n' },
    })

    const state = await worktrees.inspect({ cwd: '/work', base: 'origin/main' })

    expect(state.unpushed).toBeNull()
    expect(state.isClean).toBe(false)
  })

  it('counts unpushed commits against the base when the checkout has no upstream', async () => {
    const { worktrees } = rig({
      'git status --porcelain': { stdout: '' },
      'git rev-list --count origin/main..HEAD': { stdout: '3\n' },
    })

    const state = await worktrees.inspect({ cwd: '/work', base: 'origin/main' })

    expect(state.unpushed).toEqual({ count: 3, against: 'origin/main' })
    expect(state.upstream).toBeUndefined()
    expect(state.behind).toBeUndefined()
  })

  it('removes the worktree with force and deletes the branch it is on', async () => {
    const { worktrees, processes } = rig({
      'git rev-parse --abbrev-ref HEAD': { stdout: 'dennis/wt\n' },
      'git worktree remove --force /work/.atlas/worktrees/dennis/wt': { stdout: '' },
      'git branch -D dennis/wt': { code: 1 },
    })

    const removal = await worktrees.remove({
      cwd: '/work',
      path: '/work/.atlas/worktrees/dennis/wt',
      branch: 'dennis/wt',
      force: true,
    })

    expect(removal).toEqual({ branch: 'dennis/wt', branchDeleted: false })
    expect(processes.calls).toEqual([
      'git rev-parse --abbrev-ref HEAD',
      'git worktree remove --force /work/.atlas/worktrees/dennis/wt',
      'git branch -D dennis/wt',
    ])
  })

  it('deletes the checked-out branch when the caller names none', async () => {
    const { worktrees, processes } = rig({
      'git rev-parse --abbrev-ref HEAD': { stdout: 'dennis/wt\n' },
      'git worktree remove --force /work/.atlas/worktrees/dennis/wt': { stdout: '' },
      'git branch -D dennis/wt': { stdout: 'Deleted branch dennis/wt\n' },
    })

    const removal = await worktrees.remove({
      cwd: '/work',
      path: '/work/.atlas/worktrees/dennis/wt',
      force: true,
    })

    expect(removal).toEqual({ branch: 'dennis/wt', branchDeleted: true })
    expect(processes.calls).toContain('git branch -D dennis/wt')
  })

  it('refuses to remove a worktree that moved to another branch, removing nothing', async () => {
    const { worktrees, processes } = rig({
      'git rev-parse --abbrev-ref HEAD': { stdout: 'dennis/other\n' },
    })

    await expect(
      worktrees.remove({
        cwd: '/work',
        path: '/work/.atlas/worktrees/dennis/wt',
        branch: 'dennis/wt',
        force: true,
      }),
    ).rejects.toThrow(
      'the worktree at /work/.atlas/worktrees/dennis/wt is on dennis/other, not dennis/wt; nothing was removed',
    )

    expect(processes.calls).toEqual(['git rev-parse --abbrev-ref HEAD'])
  })

  it('refuses to remove a worktree git will not let go of', async () => {
    const { worktrees } = rig({
      'git worktree remove /work/.atlas/worktrees/dennis/wt': {
        stdout: 'fatal: contains modified or untracked files',
        code: 1,
      },
    })

    await expect(
      worktrees.remove({ cwd: '/work', path: '/work/.atlas/worktrees/dennis/wt', force: false }),
    ).rejects.toThrow('contains modified or untracked files')
  })
})
