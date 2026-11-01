import { afterAll, describe, expect, it } from 'bun:test'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  stat,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'

import { EnterWorktreeTool } from '../../../tools/builtin/enter-worktree'

const made: string[] = []

const scratch = async (): Promise<string> => {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'atlas-worktree-files-')))
  made.push(path)
  return path
}

const git = async (args: readonly string[], cwd: string): Promise<void> => {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'ignore', stderr: 'ignore' })
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}`)
}

const repo = async (worktreeYaml: string | undefined): Promise<string> => {
  const root = await scratch()
  await git(['init', '-b', 'main'], root)
  await git(['config', 'user.email', 'test@example.com'], root)
  await git(['config', 'user.name', 'Test'], root)
  await Bun.write(join(root, '.gitignore'), 'envs/.env.keys\n.cache/\n.atlas/worktrees/\n')
  await Bun.write(join(root, 'README.md'), 'hello')
  await git(['add', '.'], root)
  await git(['commit', '-m', 'initial'], root)
  await Bun.write(join(root, 'envs', '.env.keys'), 'SECRET=1')
  await chmod(join(root, 'envs', '.env.keys'), 0o600)
  await Bun.write(join(root, '.cache', 'blob'), 'cached')
  if (worktreeYaml !== undefined)
    await Bun.write(join(root, '.atlas', 'worktree.yaml'), worktreeYaml)
  return root
}

const enter = (args: { root: string; input: unknown }) =>
  new EnterWorktreeTool(args.root, () => '.atlas/worktrees').invoke({
    input: args.input,
    signal: new AbortController().signal,
    idempotencyKey: 'run:call',
    projectDirectory: args.root,
    threadId: toThreadId('thread-1'),
  })

const textOf = (outcome: { ok: boolean; modelText?: string; reason?: string }): string =>
  outcome.ok ? (outcome.modelText ?? '') : `FAILED: ${outcome.reason ?? ''}`

afterAll(async () => {
  await Promise.all(made.map((path) => rm(path, { recursive: true, force: true })))
})

const YAML =
  'copy:\n  - envs/.env.keys\n  - README.md\n  - "apps/*/.env.local"\nlink:\n  - .cache\n'

describe('.atlas/worktree.yaml on enter_worktree', () => {
  it('copies keeping the mode and links to the main checkout when creating', async () => {
    const root = await repo(YAML)
    const outcome = await enter({ root, input: { name: 'topic' } })
    const tree = join(root, '.atlas', 'worktrees', 'topic')
    const text = textOf(outcome)

    expect(await readFile(join(tree, 'envs', '.env.keys'), 'utf8')).toBe('SECRET=1')
    expect((await stat(join(tree, 'envs', '.env.keys'))).mode & 0o777).toBe(0o600)
    expect(await readlink(join(tree, '.cache'))).toBe(join(root, '.cache'))
    expect(text).toContain('copied envs/.env.keys')
    expect(text).toContain('linked .cache')
    expect(text).toContain('README.md (tracked by git)')
    expect(text).toContain('missing (no match) apps/*/.env.local')
  })

  it('runs when adopting by path and never overwrites what is there', async () => {
    const root = await repo(YAML)
    const tree = join(root, 'by-hand')
    await git(['worktree', 'add', '-b', 'topic', tree], root)
    await Bun.write(join(tree, 'envs', '.env.keys'), 'MINE')
    await mkdir(join(tree, '.cache'))

    const text = textOf(await enter({ root, input: { path: tree } }))

    expect(await readFile(join(tree, 'envs', '.env.keys'), 'utf8')).toBe('MINE')
    expect((await lstat(join(tree, '.cache'))).isSymbolicLink()).toBe(false)
    expect(text).toContain('envs/.env.keys (already present)')
    expect(text).toContain('.cache (already present)')
  })

  it('does nothing without the file', async () => {
    const root = await repo(undefined)
    const outcome = await enter({ root, input: { name: 'topic' } })
    expect(outcome.ok).toBe(true)
    expect(textOf(outcome)).not.toContain('worktree.yaml')
    expect(
      await Bun.file(join(root, '.atlas', 'worktrees', 'topic', 'envs', '.env.keys')).exists(),
    ).toBe(false)
  })

  it('reports an invalid file and still enters', async () => {
    const root = await repo('copy: [x]\nlink: [x]\n')
    const outcome = await enter({ root, input: { name: 'topic' } })
    expect(outcome.ok).toBe(true)
    expect(textOf(outcome)).toContain(
      '.atlas/worktree.yaml was not applied, so no files were copied or linked: "x" is listed under both copy and link.',
    )
  })

  it('reports refused entries and a symlinked escape', async () => {
    const outside = await scratch()
    const root = await repo('copy:\n  - ../secret\n  - /etc/hosts\n  - out/*\n')
    await Bun.write(join(outside, 'leak'), 'no')
    await Bun.spawn(['ln', '-s', outside, join(root, 'out')]).exited

    const text = textOf(await enter({ root, input: { name: 'topic' } }))

    expect(text).toContain(
      'refused ../secret (contains ..), /etc/hosts (absolute path), out (resolves outside the repository)',
    )
    expect(await Bun.file(join(root, '.atlas', 'worktrees', 'topic', 'out', 'leak')).exists()).toBe(
      false,
    )
  })
})
