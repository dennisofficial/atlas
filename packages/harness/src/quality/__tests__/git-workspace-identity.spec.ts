import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { GitWorkspaceIdentity } from '../git-workspace-identity'
import {
  git,
  initRepository,
  makeScratchDir,
  RecordingLocalProcess,
  removeScratchDirs,
} from './git-workspace-identity-fixtures'

const threadId = toThreadId('thread-identity')

const identityOver = (process = new RecordingLocalProcess()) => ({
  process,
  adapter: new GitWorkspaceIdentity({ process }),
})

afterEach(removeScratchDirs)

describe('GitWorkspaceIdentity against real repositories', () => {
  it('gives SSH and HTTPS spellings of one origin the same namespace', async () => {
    const ssh = initRepository({ origin: 'git@github.com:Org/Repo.git' })
    const https = initRepository({ origin: 'https://token:secret@github.com/Org/Repo/' })
    const { adapter } = identityOver()

    const fromSsh = await adapter.identify({ projectDirectory: ssh, threadId })
    const fromHttps = await adapter.identify({ projectDirectory: https, threadId })

    expect(fromSsh.remote).toBe('github.com/Org/Repo')
    expect(fromHttps.remote).toBe(fromSsh.remote)
    expect(fromSsh.worktreePath).toBe('main:.')
  })

  it('never puts credentials from the origin into the identity', async () => {
    const cwd = initRepository({ origin: 'https://user:hunter2@example.com/org/repo.git' })
    const { adapter } = identityOver()

    const identity = await adapter.identify({ projectDirectory: cwd, threadId })

    expect(JSON.stringify(identity)).not.toContain('hunter2')
    expect(identity.remote).toBe('example.com/org/repo')
  })

  it('falls back to local:root-commit when there is no usable remote', async () => {
    const noRemote = initRepository({})
    const pathRemote = initRepository({ origin: '/srv/git/repo.git' })
    const { adapter } = identityOver()

    const root = git({ cwd: noRemote, argv: ['rev-list', '--max-parents=0', 'HEAD'] })
    const identity = await adapter.identify({ projectDirectory: noRemote, threadId })
    const viaPath = await adapter.identify({ projectDirectory: pathRemote, threadId })

    expect(identity.remote).toBe(`local:${root}`)
    expect(viaPath.remote).toMatch(/^local:[0-9a-f]{40}$/)
  })

  it('separates linked worktrees by branch and repo-relative path', async () => {
    const main = initRepository({ origin: 'git@github.com:org/repo.git' })
    git({ cwd: main, argv: ['worktree', 'add', '.atlas/worktrees/alpha', '-b', 'feat-alpha'] })
    git({ cwd: main, argv: ['worktree', 'add', '.atlas/worktrees/beta', '-b', 'feat-beta'] })
    const { adapter } = identityOver()

    const identities = await Promise.all(
      [main, join(main, '.atlas/worktrees/alpha'), join(main, '.atlas/worktrees/beta')].map(
        (projectDirectory) => adapter.identify({ projectDirectory, threadId }),
      ),
    )

    expect(identities.map((identity) => identity.worktreePath)).toEqual([
      'main:.',
      'feat-alpha:.atlas/worktrees/alpha',
      'feat-beta:.atlas/worktrees/beta',
    ])
    expect(new Set(identities.map((identity) => identity.remote)).size).toBe(1)
  })

  it('stays stable when an equivalent clone lives under a different absolute root', async () => {
    const original = initRepository({})
    const copyRoot = join(makeScratchDir(), 'copy')
    git({ cwd: original, argv: ['clone', original, copyRoot] })
    for (const root of [original, copyRoot]) {
      git({ cwd: root, argv: ['worktree', 'add', '.atlas/worktrees/slug', '-b', 'feat-x'] })
    }
    const { adapter } = identityOver()

    for (const path of ['.', '.atlas/worktrees/slug']) {
      const before = await adapter.identify({ projectDirectory: join(original, path), threadId })
      const after = await adapter.identify({ projectDirectory: join(copyRoot, path), threadId })
      expect(after).toEqual(before)
    }
  })

  it('changes the namespace when the branch switches in the same directory', async () => {
    const cwd = initRepository({ origin: 'git@github.com:org/repo.git' })
    const { adapter } = identityOver()

    const before = await adapter.identify({ projectDirectory: cwd, threadId })
    git({ cwd, argv: ['switch', '-c', 'other'] })
    const after = await adapter.identify({ projectDirectory: cwd, threadId })
    git({ cwd, argv: ['switch', '--detach'] })
    const detached = await adapter.identify({ projectDirectory: cwd, threadId })

    expect(before.worktreePath).toBe('main:.')
    expect(after.worktreePath).toBe('other:.')
    expect(detached.worktreePath).toBe('HEAD:.')
  })

  it('reuses the immutable layout probe for the same thread and directory', async () => {
    const cwd = initRepository({})
    const { adapter, process } = identityOver()

    await adapter.identify({ projectDirectory: cwd, threadId })
    const firstCount = process.spawned.length
    await adapter.identify({ projectDirectory: cwd, threadId })

    expect(process.spawned.length - firstCount).toBe(2)
  })

  it('fails visibly outside a git work tree', async () => {
    const { adapter } = identityOver()

    await expect(
      adapter.identify({ projectDirectory: makeScratchDir(), threadId }),
    ).rejects.toThrow(/not a readable git work tree/)
  })

  it('reports no identity for an unborn repository and recovers once it has a commit, uncached', async () => {
    const cwd = makeScratchDir()
    git({ cwd, argv: ['init', '-b', 'main'] })
    const { adapter } = identityOver()

    const unborn = await adapter.identify({ projectDirectory: cwd, threadId })
    git({ cwd, argv: ['commit', '--allow-empty', '-m', 'root'] })
    const born = await adapter.identify({ projectDirectory: cwd, threadId })

    expect(unborn).toEqual({ remote: null, worktreePath: null })
    expect(born.remote).toMatch(/^local:[0-9a-f]{40}$/)
  })

  it('reports no identity for a shallow clone without an origin it can name', async () => {
    const source = initRepository({})
    git({ cwd: source, argv: ['commit', '--allow-empty', '-m', 'second'] })
    const clone = join(makeScratchDir(), 'clone')
    git({ cwd: source, argv: ['clone', '--depth', '1', `file://${source}`, clone] })
    git({ cwd: clone, argv: ['remote', 'set-url', 'origin', '/srv/local/path.git'] })
    const { adapter } = identityOver()

    expect(await adapter.identify({ projectDirectory: clone, threadId })).toEqual({
      remote: null,
      worktreePath: null,
    })
  })
})
