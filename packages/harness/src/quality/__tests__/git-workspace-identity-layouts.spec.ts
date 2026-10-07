import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import { GitWorkspaceIdentity } from '../git-workspace-identity'
import {
  git,
  initBareWithWorktrees,
  initRepository,
  makeScratchDir,
  RecordingLocalProcess,
  removeScratchDirs,
} from './git-workspace-identity-fixtures'

const threadId = toThreadId('thread-layouts')
const ORIGIN = 'git@github.com:org/repo.git'

const identify = (projectDirectory: string) =>
  new GitWorkspaceIdentity({ process: new RecordingLocalProcess() }).identify({
    projectDirectory,
    threadId,
  })

afterEach(removeScratchDirs)

describe('GitWorkspaceIdentity repository layouts', () => {
  it('identifies linked worktrees of a bare repository relative to its parent, sharing the remote', async () => {
    const { bare, checkouts } = initBareWithWorktrees({ origin: ORIGIN })
    const [alpha, beta] = checkouts as [string, string]

    const identities = await Promise.all([alpha, beta].map(identify))

    expect(identities.map((identity) => identity.worktreePath)).toEqual([
      'feat-alpha:alpha',
      'feat-beta:beta',
    ])
    expect(identities.map((identity) => identity.remote)).toEqual(['github.com/org/repo', 'github.com/org/repo'])
    expect(JSON.stringify(identities)).not.toContain(bare)
  })

  it('anchors a worktree nested inside the bare directory to the bare directory', async () => {
    const { bare } = initBareWithWorktrees({ origin: ORIGIN })
    git({ cwd: bare, argv: ['worktree', 'add', join(bare, 'trees/gamma'), '-b', 'feat-gamma', 'main'] })

    const identity = await identify(join(bare, 'trees/gamma'))

    expect(identity).toEqual({ remote: 'github.com/org/repo', worktreePath: 'feat-gamma:trees/gamma' })
  })

  it('keeps an ordinary clone and its linked worktree on repo-relative paths', async () => {
    const main = initRepository({ origin: ORIGIN })
    git({ cwd: main, argv: ['worktree', 'add', '.atlas/worktrees/slug', '-b', 'feat-slug'] })

    expect((await identify(main)).worktreePath).toBe('main:.')
    expect(await identify(join(main, '.atlas/worktrees/slug'))).toEqual({
      remote: 'github.com/org/repo',
      worktreePath: 'feat-slug:.atlas/worktrees/slug',
    })
  })

  it('identifies a separate-git-dir checkout and its linked worktree without an absolute path', async () => {
    const gitDirectory = join(makeScratchDir(), 'sep.git')
    const checkout = join(makeScratchDir(), 'checkout')
    git({ cwd: makeScratchDir(), argv: ['init', '-b', 'main', `--separate-git-dir=${gitDirectory}`, checkout] })
    git({ cwd: checkout, argv: ['commit', '--allow-empty', '-m', 'root'] })
    git({ cwd: checkout, argv: ['worktree', 'add', '.atlas/worktrees/slug', '-b', 'feat-slug'] })

    const main = await identify(checkout)
    const linked = await identify(join(checkout, '.atlas/worktrees/slug'))

    expect(main.worktreePath).toBe('main:.')
    expect(linked.worktreePath).toBe('feat-slug:.atlas/worktrees/slug')
    expect(linked.remote).toBe(main.remote)
    expect(main.remote).toMatch(/^local:[0-9a-f]{40}$/)
  })

  it('treats a submodule as its own main root rather than the superproject', async () => {
    const library = initRepository({ origin: 'https://github.com/org/library.git' })
    const superproject = initRepository({ origin: ORIGIN })
    git({
      cwd: superproject,
      argv: ['-c', 'protocol.file.allow=always', 'submodule', 'add', library, 'vendor/library'],
    })
    const submodule = join(superproject, 'vendor/library')
    git({ cwd: submodule, argv: ['remote', 'set-url', 'origin', 'https://github.com/org/library.git'] })
    git({ cwd: submodule, argv: ['worktree', 'add', join(superproject, 'linked-lib'), '-b', 'feat-lib'] })

    expect(await identify(submodule)).toEqual({ remote: 'github.com/org/library', worktreePath: 'main:.' })
    expect((await identify(join(superproject, 'linked-lib'))).worktreePath).toStartWith('feat-lib:')
    expect(await identify(superproject)).toEqual({ remote: 'github.com/org/repo', worktreePath: 'main:.' })
  })
})
