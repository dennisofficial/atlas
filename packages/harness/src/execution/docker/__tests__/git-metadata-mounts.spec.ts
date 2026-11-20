import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sandboxConfigFromHost } from '../host-environment'
import { sandboxCreateBody } from '../sandbox'
import { EMountMode } from '../../image/mounts'

let root: string

const git = (args: { cwd: string; argv: string[] }): void => {
  const result = Bun.spawnSync(['git', ...args.argv], { cwd: args.cwd })
  if (!result.success) throw new Error(result.stderr.toString())
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-git-mounts-')))
  git({ cwd: root, argv: ['init', '-b', 'main', 'repository'] })
  git({
    cwd: join(root, 'repository'),
    argv: [
      '-c',
      'user.name=Sandbox Test',
      '-c',
      'user.email=sandbox@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-m',
      'fixture',
    ],
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('Git metadata in host sandbox configuration', () => {
  it('leaves ordinary repositories and non-repositories without extra metadata mounts', () => {
    for (const worktree of [root, join(root, 'repository')]) {
      const config = sandboxConfigFromHost({
        worktree,
        session: worktree,
        limits: { cpus: 1, memoryBytes: 512 * 1024 ** 2 },
        atlasHomeSubtrees: [],
      })
      expect(config.mounts).toEqual([])
    }
  })

  it.each(['.atlas', '.claude'])('finds metadata for linked worktrees under %s', (directory) => {
    const repository = join(root, 'repository')
    const worktree = join(repository, directory, 'worktrees', 'linked')
    git({ cwd: repository, argv: ['worktree', 'add', '-b', 'linked', worktree] })

    const config = sandboxConfigFromHost({
      worktree,
      session: worktree,
      limits: { cpus: 1, memoryBytes: 512 * 1024 ** 2 },
      atlasHomeSubtrees: [],
    })

    expect(config.mounts).toEqual([{ path: join(repository, '.git'), mode: EMountMode.ReadWrite }])
  })

  it('mounts a linked worktree and its external common directory without the main working tree', () => {
    const repository = join(root, 'repository')
    const worktree = join(root, 'linked')
    git({ cwd: repository, argv: ['worktree', 'add', '-b', 'linked', worktree] })

    const body = sandboxCreateBody(
      sandboxConfigFromHost({
        worktree,
        session: worktree,
        limits: { cpus: 1, memoryBytes: 512 * 1024 ** 2 },
        atlasHomeSubtrees: [],
      }),
    )

    const binds = body.HostConfig?.Binds ?? []
    expect(binds).toContain(`${worktree}:${worktree}`)
    expect(binds).toContain(`${repository}/.git:${repository}/.git`)
    expect(binds).not.toContain(`${repository}:${repository}`)
    expect(binds.some((bind) => bind.includes('/.git/worktrees/'))).toBe(false)
  })
})
