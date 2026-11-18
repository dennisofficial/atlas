import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { BranchSet, CallOp, DaemonEvent } from '@dltech/atlas-protocol'
import type { CallContext } from '@dltech/atlas-protocol/engine'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { gitGroup } from '..'

type Rig = {
  events: DaemonEvent[]
  call(op: CallOp): Promise<unknown>
  sets(): BranchSet[]
  stop(): Promise<void>
}

const git = (args: { cwd: string; argv: readonly string[] }): string =>
  execFileSync('git', args.argv, {
    cwd: args.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

const makeRepo = async (args: { dir: string; remote?: string }): Promise<string> => {
  await mkdir(args.dir, { recursive: true })
  git({ cwd: args.dir, argv: ['init', '-q', '-b', 'main'] })
  git({ cwd: args.dir, argv: ['config', 'user.email', 'spec@atlas.test'] })
  git({ cwd: args.dir, argv: ['config', 'user.name', 'spec'] })
  await writeFile(join(args.dir, 'file.txt'), 'one')
  git({ cwd: args.dir, argv: ['add', '.'] })
  git({ cwd: args.dir, argv: ['commit', '-qm', 'one'] })
  if (args.remote !== undefined)
    git({ cwd: args.dir, argv: ['remote', 'add', 'origin', args.remote] })
  return args.dir
}

const waitUntil = async (ready: () => boolean, ms = 5_000): Promise<void> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('the git group never reported the change')
}

const quiet = async (ms = 900): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, ms))

describe('git group', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'atlas-git-spec-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const rig = (): Rig => {
    const events: DaemonEvent[] = []
    const group = gitGroup({ env: {}, home: root })({ publish: (event) => events.push(event) })
    const ctx: CallContext = {
      key: 'k',
      signal: new AbortController().signal,
      output: () => undefined,
      publish: () => undefined,
    }
    return {
      events,
      call: async (op) => {
        const registered = group.ops.find((candidate) => candidate.op === op.op)
        if (registered === undefined) throw new Error(`no op ${op.op}`)
        return await registered.run({ op, ctx })
      },
      sets: () => events.flatMap((event) => (event.type === 'git.branches' ? [event.set] : [])),
      stop: async () => {
        await group.stop?.()
      },
    }
  }

  it('reports the push remote of a fork branch and the configured remotes', async () => {
    const repoPath = await makeRepo({
      dir: join(root, 'forked'),
      remote: 'git@github.com:acme/app.git',
    })
    git({ cwd: repoPath, argv: ['remote', 'add', 'fork', 'git@github.com:dennis/app.git'] })
    git({ cwd: repoPath, argv: ['checkout', '-qb', 'feat-a'] })
    git({ cwd: repoPath, argv: ['config', 'branch.feat-a.pushRemote', 'fork'] })
    const { call, stop } = rig()
    const set = (await call({ op: 'git.read', repoPath })) as BranchSet
    expect(set.branches.find((branch) => branch.name === 'feat-a')?.pushRemote).toBe('fork')
    expect(set.branches.find((branch) => branch.name === 'main')?.pushRemote).toBeNull()
    expect(set.remotes).toEqual([
      { name: 'fork', url: 'git@github.com:dennis/app.git' },
      { name: 'origin', url: 'git@github.com:acme/app.git' },
    ])
    await stop()
  })

  it('reports a checkout round trip inside one debounce window', async () => {
    const repoPath = await makeRepo({ dir: join(root, 'trips') })
    const { call, sets, stop } = rig()
    await call({ op: 'git.watch', repoPath })
    git({ cwd: repoPath, argv: ['checkout', '-qb', 'feat-b'] })
    git({ cwd: repoPath, argv: ['checkout', '-q', 'main'] })
    git({ cwd: repoPath, argv: ['checkout', '-q', 'feat-b'] })
    git({ cwd: repoPath, argv: ['checkout', '-q', 'main'] })
    await waitUntil(() => sets().some((set) => set.checkouts.includes('feat-b')))
    const set = (await call({ op: 'git.read', repoPath })) as BranchSet
    expect(set.checkouts[0]).toBe('main')
    expect(set.checkouts).toContain('feat-b')
    await stop()
  })

  it('keeps a deleted branch in checkouts', async () => {
    const repoPath = await makeRepo({ dir: join(root, 'deleted') })
    git({ cwd: repoPath, argv: ['checkout', '-qb', 'feat-gone'] })
    git({ cwd: repoPath, argv: ['checkout', '-q', 'main'] })
    git({ cwd: repoPath, argv: ['branch', '-D', 'feat-gone'] })
    const { call, stop } = rig()
    const set = (await call({ op: 'git.read', repoPath })) as BranchSet
    expect(set.checkouts).toContain('feat-gone')
    expect(set.branches.some((branch) => branch.name === 'feat-gone')).toBe(false)
    await stop()
  })
})

describe('git.discover', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'atlas-git-discover-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const discovered = (events: DaemonEvent[]): string[] =>
    events.flatMap((event) => (event.type === 'git.repo-found' ? [event.repoPath] : []))

  const rig = () => {
    const events: DaemonEvent[] = []
    const group = gitGroup({ env: {}, home: root })({ publish: (event) => events.push(event) })
    const ctx: CallContext = {
      key: 'k',
      signal: new AbortController().signal,
      output: () => undefined,
      publish: () => undefined,
    }
    return {
      events,
      call: async (op: CallOp) => {
        const registered = group.ops.find((candidate) => candidate.op === op.op)
        if (registered === undefined) throw new Error(`no op ${op.op}`)
        return await registered.run({ op, ctx })
      },
      stop: async () => {
        await group.stop?.()
      },
    }
  }

  it('reports a clone created after arming, once', async () => {
    const workspaces = join(root, 'workspaces')
    await mkdir(workspaces, { recursive: true })
    const { call, events, stop } = rig()
    await expect(call({ op: 'git.discover', root: workspaces })).resolves.toEqual({ repos: [] })
    const nested = await makeRepo({ dir: join(workspaces, 'group', 'inner') })
    await waitUntil(() => discovered(events).includes(nested))
    await makeRepo({ dir: join(workspaces, 'sibling') })
    await waitUntil(() => discovered(events).length === 2)
    await quiet()
    expect(discovered(events).filter((path) => path === nested)).toHaveLength(1)
    await stop()
  })

  it('reports the repos already present at arm time and ignores node_modules', async () => {
    const workspaces = join(root, 'workspaces-late')
    const existing = await makeRepo({ dir: join(workspaces, 'existing') })
    const ignored = await makeRepo({ dir: join(workspaces, 'node_modules', 'pkg') })
    const { call, events, stop } = rig()
    await expect(call({ op: 'git.discover', root: workspaces })).resolves.toEqual({
      repos: [existing],
    })
    await quiet()
    expect(discovered(events)).toEqual([])
    expect(discovered(events)).not.toContain(ignored)
    await stop()
  })
})
