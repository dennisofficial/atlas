import { afterAll, describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { fingerprintWorkspaceTree } from '../capture-fingerprint'
import { workspaceManifestSchema } from '../manifest'
import { EWorkspaceRestoreMode, restoreWorkspaceArchive } from '../restore'
import {
  capture,
  cleanupScratches,
  createFixture,
  createScratch,
  git,
  untar,
  type Fixture,
} from './capture-fixture'

const fixtures: Fixture[] = []

const fixture = async (): Promise<Fixture> => {
  const made = await createFixture()
  fixtures.push(made)
  return made
}

afterAll(async () => {
  await Promise.all(fixtures.map((made) => made.cleanup()))
  await cleanupScratches()
})

const packedRefs = async (extracted: string): Promise<string> =>
  readFile(join(extracted, 'git', 'packed-refs'), 'utf8')

describe('a linked-worktree session capture is scoped to main plus the session tree', () => {
  it('excludes sibling worktrees from the archive trees and their files', async () => {
    const made = await fixture()
    const { manifest, extracted } = await capture({ cwd: made.nested })

    expect(workspaceManifestSchema.parse(manifest)).toEqual(manifest)
    expect(manifest.trees.map((tree) => tree.name).sort()).toEqual(['feat', 'main'])
    expect(manifest.trees.map((tree) => tree.sourcePath)).not.toContain(made.detached)
    const nestedFiles = await readFile(join(extracted, 'trees', manifest.activeId, 'files', 'README.md'), 'utf8')
    expect(nestedFiles).toBe('nested edit\n')
  })

  it('carries the staged blobs of every covered tree, including staged-untracked files', async () => {
    const made = await fixture()
    const { extracted } = await capture({ cwd: made.nested })
    const probe = await createScratch()
    const admin = join(probe, 'git')
    await Bun.spawn(['cp', '-R', join(extracted, 'git'), admin]).exited
    const head = await readFile(join(extracted, 'trees', 'main', 'git-state', 'HEAD'), 'utf8')
    await Bun.write(join(admin, 'HEAD'), head)

    const mainStaged = await git({ args: ['rev-parse', ':staged.txt'], cwd: made.main })
    const nestedStaged = await git({ args: ['rev-parse', ':feat.txt'], cwd: made.nested })
    const nestedCommitted = await git({ args: ['rev-parse', 'HEAD:README.md'], cwd: made.nested })
    for (const blob of [mainStaged, nestedStaged, nestedCommitted]) {
      await git({ args: ['--git-dir', admin, 'cat-file', '-e', blob], cwd: probe })
    }
  })

  it('carry only the branches the covered trees are on, plus stash', async () => {
    const made = await fixture()
    await git({ args: ['branch', 'side'], cwd: made.main })
    await git({ args: ['tag', 'v9'], cwd: made.main })
    await git({ args: ['stash', 'push', '-u', '-m', 'session stash'], cwd: made.nested })

    const { extracted } = await capture({ cwd: made.nested })
    const packed = await packedRefs(extracted)

    expect(packed).toContain('refs/heads/main')
    expect(packed).toContain('refs/heads/feat')
    expect(packed).toContain('refs/stash')
    expect(packed).not.toContain('refs/heads/side')
    expect(packed).not.toContain('refs/tags/')
  })

  it('keeps manifest and fingerprint semantics: per-tree fingerprints match the live trees', async () => {
    const made = await fixture()
    const { manifest } = await capture({ cwd: made.nested })

    expect(manifest.version).toBe(1)
    expect(manifest.activeId).not.toBe('main')
    for (const tree of manifest.trees) {
      expect(tree.fingerprint).toBe(await fingerprintWorkspaceTree({ cwd: tree.sourcePath }))
      expect(tree.head).toBe(await git({ args: ['rev-parse', 'HEAD'], cwd: tree.sourcePath }))
    }
  })

  it('restores in cloud mode as main at the root plus the session worktree under .atlas/worktrees', async () => {
    const made = await fixture()
    const { destination } = await capture({ cwd: made.nested })
    const target = join(await createScratch(), 'cloud')

    const restored = await restoreWorkspaceArchive({ archivePath: destination, destination: target, mode: EWorkspaceRestoreMode.Cloud })

    expect(restored.cwd).toBe(join(target, '.atlas', 'worktrees', 'feat'))
    expect(await readFile(join(target, 'README.md'), 'utf8')).toBe('hello, edited\n')
    expect(await readFile(join(restored.cwd, 'README.md'), 'utf8')).toBe('nested edit\n')
    const worktrees = (await git({ args: ['worktree', 'list', '--porcelain'], cwd: target }))
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
    expect(worktrees).toHaveLength(2)
    expect(await git({ args: ['symbolic-ref', 'HEAD'], cwd: target })).toBe('refs/heads/main')
    expect(await git({ args: ['symbolic-ref', 'HEAD'], cwd: restored.cwd })).toBe('refs/heads/feat')
    const sibling = await git({ args: ['rev-parse', '--verify', '--quiet', 'refs/heads/detached-side'], cwd: target }).catch(() => 'missing')
    expect(sibling).toBe('missing')
  })

  it('restores host-side onto a repo that has more worktrees and refs than the archive', async () => {
    const made = await fixture()
    const { destination } = await capture({ cwd: made.nested })

    const host = join(await createScratch(), 'host')
    const hostNested = join(host, '.atlas', 'worktrees', 'feat')
    await restoreWorkspaceArchive({ archivePath: destination, destination: host, mode: EWorkspaceRestoreMode.Cloud })
    await git({ args: ['branch', 'host-only'], cwd: host })
    const other = join(host, '.atlas', 'worktrees', 'other')
    await git({ args: ['worktree', 'add', other, '-b', 'other'], cwd: host })
    await git({ args: ['tag', 'host-tag'], cwd: host })
    await Bun.write(join(other, 'marker.txt'), 'host side\n')

    const restored = await restoreWorkspaceArchive({ archivePath: destination, destination: host, mode: EWorkspaceRestoreMode.Host })

    expect(restored.cwd).toBe(hostNested)
    expect(await readFile(join(hostNested, 'README.md'), 'utf8')).toBe('nested edit\n')
    expect(await git({ args: ['rev-parse', '--verify', 'refs/heads/host-only'], cwd: host })).not.toBe('')
    expect(await git({ args: ['rev-parse', '--verify', 'refs/tags/host-tag'], cwd: host })).not.toBe('')
    expect((await git({ args: ['worktree', 'list', '--porcelain'], cwd: host })).split('\n').filter((line) => line.startsWith('worktree '))).toHaveLength(3)
    expect(await readFile(join(other, 'marker.txt'), 'utf8')).toBe('host side\n')
    expect(await readFile(join(other, 'README.md'), 'utf8').catch(() => 'gone')).not.toBe('nested edit\n')
  })
})
