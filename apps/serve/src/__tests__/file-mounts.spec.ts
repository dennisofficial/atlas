import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { EFileMountState, mountProjectFiles, type FileMountGit } from '../file-mounts'

const roots: string[] = []

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-file-mounts-'))
  roots.push(dir)
  return dir
}

const git = (cwd: string, ...argv: string[]): void => {
  execFileSync('git', argv, { cwd, stdio: 'ignore' })
}

const repo = (files: Record<string, string> = {}): string => {
  const dir = tempDir()
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 'a@b.c')
  git(dir, 'config', 'user.name', 'tester')
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), contents)
  }
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init', '--allow-empty')
  return dir
}

const realExit = async (args: { cwd: string; argv: string[] }): Promise<number> => {
  try {
    execFileSync('git', args.argv, { cwd: args.cwd, stdio: 'ignore' })
    return 0
  } catch (failure) {
    const status = (failure as { status?: number }).status
    return status ?? 1
  }
}

const mount = (path: string, contents = 'SECRET=1\n', mode = 0o600) => ({ path, contents, mode })

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('mountProjectFiles', () => {
  it('writes a gitignored file without touching the exclude file', async () => {
    const dir = repo({ '.gitignore': '.env\n' })
    const report = await mountProjectFiles({
      mounts: [mount('.env')],
      repositoryDir: dir,
      homeDir: tempDir(),
    })
    expect(report.outcomes).toEqual([{ path: '.env', state: EFileMountState.Written }])
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('SECRET=1\n')
    expect(existsSync(join(dir, '.git/info/exclude'))).toBe(true)
    expect(readFileSync(join(dir, '.git/info/exclude'), 'utf8')).not.toContain('/.env')
  })

  it('writes a non-ignored file and excludes it locally once', async () => {
    const dir = repo()
    const run = () =>
      mountProjectFiles({
        mounts: [mount('conf/local.env')],
        repositoryDir: dir,
        homeDir: tempDir(),
      })
    const report = await run()
    await run()
    expect(report.outcomes).toEqual([
      { path: 'conf/local.env', state: EFileMountState.WrittenLocallyExcluded },
    ])
    const exclude = readFileSync(join(dir, '.git/info/exclude'), 'utf8')
    expect(exclude.split('\n').filter((line) => line === '/conf/local.env')).toHaveLength(1)
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString()).toBe('')
  })

  it('skips a tracked file and leaves its contents alone', async () => {
    const dir = repo({ 'app.env': 'original\n' })
    const report = await mountProjectFiles({
      mounts: [mount('app.env', 'replaced\n')],
      repositoryDir: dir,
      homeDir: tempDir(),
    })
    expect(report.outcomes).toEqual([{ path: 'app.env', state: EFileMountState.SkippedTracked }])
    expect(readFileSync(join(dir, 'app.env'), 'utf8')).toBe('original\n')
  })

  it('creates missing parent folders and overwrites existing files', async () => {
    const dir = repo({ '.gitignore': 'deep/\n' })
    const mounts = [mount('deep/er/still/key.pem', 'one')]
    await mountProjectFiles({ mounts, repositoryDir: dir, homeDir: tempDir() })
    await mountProjectFiles({
      mounts: [mount('deep/er/still/key.pem', 'two')],
      repositoryDir: dir,
      homeDir: tempDir(),
    })
    expect(readFileSync(join(dir, 'deep/er/still/key.pem'), 'utf8')).toBe('two')
  })

  it('applies the mount mode', async () => {
    const dir = repo({ '.gitignore': '*.key\n' })
    await mountProjectFiles({
      mounts: [mount('a.key', 'x', 0o640), mount('b.key')],
      repositoryDir: dir,
      homeDir: tempDir(),
    })
    expect(statSync(join(dir, 'a.key')).mode & 0o777).toBe(0o640)
    expect(statSync(join(dir, 'b.key')).mode & 0o777).toBe(0o600)
  })

  it('writes home targets under the home dir with no git calls', async () => {
    const home = tempDir()
    const calls: string[][] = []
    const spy: FileMountGit = async ({ argv }) => {
      calls.push(argv)
      return { exitCode: 0, stdout: '' }
    }
    const report = await mountProjectFiles({
      mounts: [mount('~/.config/dotenvx/.env', 'KEY=1')],
      repositoryDir: null,
      homeDir: home,
      git: spy,
    })
    expect(report.outcomes).toEqual([
      { path: '~/.config/dotenvx/.env', state: EFileMountState.Written },
    ])
    expect(readFileSync(join(home, '.config/dotenvx/.env'), 'utf8')).toBe('KEY=1')
    expect(calls).toEqual([])
  })

  it('fails invalid paths without writing', async () => {
    const dir = repo()
    const report = await mountProjectFiles({
      mounts: [mount('../escape.txt'), mount('.git/hooks/pre-commit')],
      repositoryDir: dir,
      homeDir: tempDir(),
    })
    expect(report.outcomes.map((outcome) => outcome.state)).toEqual([
      EFileMountState.Failed,
      EFileMountState.Failed,
    ])
    expect(existsSync(join(dir, '..', 'escape.txt'))).toBe(false)
  })

  it('fails when a parent folder is a symlink leaving the root', async () => {
    const dir = repo()
    const outside = tempDir()
    symlinkSync(outside, join(dir, 'link'))
    const report = await mountProjectFiles({
      mounts: [mount('link/stolen.txt')],
      repositoryDir: dir,
      homeDir: tempDir(),
    })
    expect(report.outcomes[0]?.state).toBe(EFileMountState.Failed)
    expect(existsSync(join(outside, 'stolen.txt'))).toBe(false)
  })

  it('skips repository targets when there is no repository', async () => {
    const report = await mountProjectFiles({
      mounts: [mount('.env')],
      repositoryDir: null,
      homeDir: tempDir(),
    })
    expect(report.outcomes).toEqual([{ path: '.env', state: EFileMountState.SkippedNoRepository }])
  })

  it('never puts contents in a failure reason', async () => {
    const dir = repo()
    const report = await mountProjectFiles({
      mounts: [mount('../x', 'TOPSECRETVALUE')],
      repositoryDir: dir,
      homeDir: tempDir(),
    })
    expect(JSON.stringify(report)).not.toContain('TOPSECRETVALUE')
  })

  it('fails closed when git cannot say whether the path is tracked', async () => {
    const dir = repo()
    const broken: FileMountGit = async ({ argv }) =>
      argv[0] === 'ls-files' ? { exitCode: 128, stdout: '' } : { exitCode: 0, stdout: '' }
    const report = await mountProjectFiles({
      mounts: [mount('.env')],
      repositoryDir: dir,
      homeDir: tempDir(),
      git: broken,
    })
    expect(report.outcomes).toEqual([
      {
        path: '.env',
        state: EFileMountState.Failed,
        reason: 'git could not check whether the path is tracked',
      },
    ])
    expect(existsSync(join(dir, '.env'))).toBe(false)
  })

  it('skips when the repository root is not a work tree', async () => {
    const dir = tempDir()
    const report = await mountProjectFiles({
      mounts: [mount('.env')],
      repositoryDir: dir,
      homeDir: tempDir(),
      git: async () => ({ exitCode: 128, stdout: '' }),
    })
    expect(report.outcomes).toEqual([{ path: '.env', state: EFileMountState.SkippedNoRepository }])
    expect(existsSync(join(dir, '.env'))).toBe(false)
  })

  it('leaves no staging file when the rename fails', async () => {
    const dir = repo()
    mkdirSync(join(dir, '.env'))
    const report = await mountProjectFiles({
      mounts: [mount('.env', 'A=1')],
      repositoryDir: dir,
      homeDir: tempDir(),
    })
    expect(report.outcomes[0]?.state).toBe(EFileMountState.Failed)
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('reports a written file that could not be excluded', async () => {
    const dir = repo()
    const noExclude: FileMountGit = async ({ cwd, argv }) =>
      argv[0] === 'rev-parse' && argv[1] === '--git-path'
        ? { exitCode: 1, stdout: '' }
        : { exitCode: await realExit({ cwd, argv }), stdout: '' }
    const report = await mountProjectFiles({
      mounts: [mount('conf.env')],
      repositoryDir: dir,
      homeDir: tempDir(),
      git: noExclude,
    })
    expect(report.outcomes[0]?.state).toBe(EFileMountState.WrittenNotExcluded)
    expect(report.outcomes[0]?.reason).toBe('git did not name its exclude file')
    expect(readFileSync(join(dir, 'conf.env'), 'utf8')).toBe('SECRET=1\n')
  })

  it('allows a first segment that merely starts with two dots', async () => {
    const dir = repo()
    const report = await mountProjectFiles({
      mounts: [mount('..env')],
      repositoryDir: dir,
      homeDir: tempDir(),
    })
    expect(report.outcomes[0]?.state).toBe(EFileMountState.WrittenLocallyExcluded)
    expect(existsSync(join(dir, '..env'))).toBe(true)
  })

  it('escapes gitignore specials and tolerates CRLF duplicates', async () => {
    const dir = repo()
    const path = '#a*b?[c] '.trimEnd() + 'd.env'
    const run = () =>
      mountProjectFiles({ mounts: [mount(path)], repositoryDir: dir, homeDir: tempDir() })
    writeFileSync(join(dir, '.git/info/exclude'), '/\\#a\\*b\\?\\[c]d.env\r\n')
    await run()
    const exclude = readFileSync(join(dir, '.git/info/exclude'), 'utf8')
    expect(exclude.split('\n').filter((line) => line.includes('d.env'))).toHaveLength(1)
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString()).toBe('')
  })
})
