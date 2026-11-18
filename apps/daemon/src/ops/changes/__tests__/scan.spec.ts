import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EChangeFileStatus, type CallOp, type ChangesManifest } from '@dltech/atlas-protocol'
import type { CallContext } from '@dltech/atlas-protocol/engine'
import { afterEach, describe, expect, it } from 'bun:test'

import { changesGroup } from '..'
import type { DaemonOpsDeps } from '../../deps'

const made: string[] = []

const git = (cwd: string, argv: readonly string[]): string =>
  execFileSync('git', ['-C', cwd, ...argv], { encoding: 'utf8' })

const repoDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-changes-'))
  made.push(dir)
  return dir
}

const commit = (cwd: string, message: string): void => {
  git(cwd, ['add', '-A'])
  git(cwd, ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', message])
}

const deps = (): DaemonOpsDeps => ({ env: { PATH: process.env.PATH }, home: tmpdir() })

const scan = async (args: { repoPath: string; base: string | null }): Promise<ChangesManifest> => {
  const group = changesGroup(deps())({ publish: () => undefined })
  const registered = group.ops.find((candidate) => candidate.op === 'changes.scan')
  if (registered === undefined) throw new Error('no changes.scan op')
  const ctx: CallContext = {
    key: 'k',
    signal: new AbortController().signal,
    output: () => undefined,
    publish: () => undefined,
  }
  const op: CallOp = { op: 'changes.scan', repoPath: args.repoPath, base: args.base }
  return (await registered.run({ op, ctx })) as ChangesManifest
}

const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('changes.scan', () => {
  it('reports status, rename, counts, binary, hashes and sizes against the base', async () => {
    const dir = repoDir()
    git(dir, ['init', '-q', '-b', 'main'])
    writeFileSync(join(dir, 'keep.txt'), 'one\ntwo\nthree\n')
    writeFileSync(join(dir, 'gone.txt'), 'bye\n')
    writeFileSync(join(dir, 'moved.txt'), 'move me\n')
    commit(dir, 'one')
    const base = git(dir, ['rev-parse', 'HEAD']).trim()

    writeFileSync(join(dir, 'keep.txt'), 'one\ntwo\nthree\nfour\n')
    rmSync(join(dir, 'gone.txt'))
    git(dir, ['mv', 'moved.txt', 'renamed.txt'])
    writeFileSync(join(dir, 'fresh.txt'), 'a\nb\n')
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([0, 1, 2, 3]))
    writeFileSync(join(dir, '.gitignore'), 'ignored.txt\n')
    writeFileSync(join(dir, 'ignored.txt'), 'never\n')

    const manifest = await scan({ repoPath: dir, base })
    const byPath = new Map(manifest.files.map((file) => [file.path, file]))

    expect(manifest.base).toBe(base)
    expect(byPath.get('keep.txt')).toMatchObject({
      status: EChangeFileStatus.Modified,
      additions: 1,
      deletions: 0,
      binary: false,
      baseHash: sha('one\ntwo\nthree\n'),
      currentHash: sha('one\ntwo\nthree\nfour\n'),
      baseSize: 14,
      currentSize: 19,
    })
    expect(byPath.get('gone.txt')).toMatchObject({
      status: EChangeFileStatus.Deleted,
      currentHash: null,
      currentSize: null,
      deletions: 1,
    })
    expect(byPath.get('renamed.txt')).toMatchObject({
      status: EChangeFileStatus.Modified,
      oldPath: 'moved.txt',
      baseHash: sha('move me\n'),
    })
    expect(byPath.get('fresh.txt')).toMatchObject({
      status: EChangeFileStatus.Added,
      baseHash: null,
      baseSize: null,
      additions: 2,
    })
    expect(byPath.get('blob.bin')).toMatchObject({
      status: EChangeFileStatus.Added,
      binary: true,
      additions: 0,
      deletions: 0,
    })
    expect(byPath.has('ignored.txt')).toBe(false)
  })

  it('reports a null base and the whole tree when the repo has no commit', async () => {
    const dir = repoDir()
    git(dir, ['init', '-q', '-b', 'main'])
    writeFileSync(join(dir, 'first.txt'), 'hello\n')

    const manifest = await scan({ repoPath: dir, base: null })
    expect(manifest.base).toBeNull()
    expect(manifest.files).toHaveLength(1)
    expect(manifest.files[0]).toMatchObject({
      path: 'first.txt',
      status: EChangeFileStatus.Added,
      baseHash: null,
      additions: 1,
    })
  })

  it('hashes a symlink by its target and leaves a submodule without sides', async () => {
    const dir = repoDir()
    git(dir, ['init', '-q', '-b', 'main'])
    writeFileSync(join(dir, 'anchor.txt'), 'anchor\n')
    commit(dir, 'one')
    const base = git(dir, ['rev-parse', 'HEAD']).trim()

    symlinkSync('anchor.txt', join(dir, 'link.txt'))
    mkdirSync(join(dir, 'vendor'))
    git(dir, ['update-index', '--add', '--cacheinfo', `160000,${base},vendor`])

    const manifest = await scan({ repoPath: dir, base })
    const byPath = new Map(manifest.files.map((file) => [file.path, file]))
    expect(byPath.get('link.txt')).toMatchObject({
      status: EChangeFileStatus.Added,
      currentHash: sha('anchor.txt'),
      currentSize: 10,
    })
    expect(byPath.get('vendor')).toMatchObject({
      status: EChangeFileStatus.Added,
      binary: true,
      baseHash: null,
      currentHash: null,
      baseSize: null,
      currentSize: null,
    })
  })
})
