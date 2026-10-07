import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProcessHandle, ProcessPort, SpawnCommand, ThreadId } from '@dltech/atlas-core'

import { LocalProcessPort } from '../../execution/local-process'

const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'Identity Spec',
  GIT_AUTHOR_EMAIL: 'identity@example.test',
  GIT_COMMITTER_NAME: 'Identity Spec',
  GIT_COMMITTER_EMAIL: 'identity@example.test',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
}

const scratchDirs: string[] = []

export const makeScratchDir = (): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-identity-')))
  scratchDirs.push(dir)
  return dir
}

export const removeScratchDirs = (): void => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
}

export const git = (args: { cwd: string; argv: readonly string[] }): string => {
  const result = Bun.spawnSync({
    cmd: ['git', ...args.argv],
    cwd: args.cwd,
    env: { ...process.env, ...GIT_ENV },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.argv.join(' ')} failed: ${result.stderr.toString()}`)
  }
  return result.stdout.toString().trim()
}

export const initRepository = (args: { origin?: string }): string => {
  const cwd = makeScratchDir()
  git({ cwd, argv: ['init', '-b', 'main'] })
  git({ cwd, argv: ['commit', '--allow-empty', '-m', 'root'] })
  if (args.origin !== undefined) git({ cwd, argv: ['remote', 'add', 'origin', args.origin] })
  return cwd
}

export class RecordingLocalProcess implements ProcessPort {
  readonly spawned: SpawnCommand[] = []
  private readonly local = new LocalProcessPort()

  spawn(args: SpawnCommand): ProcessHandle {
    this.spawned.push(args)
    return this.local.spawn(args)
  }

  which(args: { command: string; threadId?: ThreadId | undefined }): string | null {
    return this.local.which(args)
  }
}

export const initBareWithWorktrees = (args: { origin?: string }): { bare: string; checkouts: string[] } => {
  const source = initRepository(args)
  const parent = makeScratchDir()
  const bare = join(parent, 'repo.git')
  git({ cwd: parent, argv: ['clone', '--bare', source, bare] })
  if (args.origin !== undefined) git({ cwd: bare, argv: ['remote', 'set-url', 'origin', args.origin] })
  const checkouts = ['alpha', 'beta'].map((name) => {
    const path = join(parent, name)
    git({ cwd: bare, argv: ['worktree', 'add', path, '-b', `feat-${name}`, 'main'] })
    return path
  })
  return { bare, checkouts }
}
