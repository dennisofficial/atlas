import { afterEach, describe, expect, it } from 'bun:test'
import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { captureWorkspaceArchive } from '../capture'
import { EWorkspaceRestoreMode, restoreWorkspaceArchive } from '../restore'
import { cleanupScratches, createFamilyFixture, createScratch, git } from './family-fixture'

afterEach(cleanupScratches)

const capturePlain = async ({ cwd, family }: { cwd: string; family?: Parameters<typeof captureWorkspaceArchive>[0]['family'] }) => {
  const archivePath = join(await createScratch(), 'workspace.tar.gz')
  await captureWorkspaceArchive({ cwd, destination: archivePath, family })
  return archivePath
}

const cloudRestore = async (archivePath: string) => {
  const destination = join(await createScratch(), 'cloud')
  const restored = await restoreWorkspaceArchive({ archivePath, destination, mode: EWorkspaceRestoreMode.Cloud })
  return { destination, restored }
}

const reflogShas = async ({ cwd, ref }: { cwd: string; ref: string }): Promise<string[]> => {
  const out = await git({ args: ['reflog', 'show', '--format=%H', ref], cwd }).catch(() => '')
  return out.split('\n').filter((line) => line.length > 0)
}

describe('reflog reachability in a scoped capture', () => {
  it('keeps objects a main HEAD reflog and two stash entries reference beyond current ref tips', async () => {
    const made = await createFamilyFixture()
    const { main } = made
    await git({ args: ['checkout', '-b', 'uncovered-visit'], cwd: main })
    await writeFile(join(main, 'visit.txt'), 'visited\n')
    await git({ args: ['add', 'visit.txt'], cwd: main })
    await git({ args: ['commit', '-m', 'visited only'], cwd: main })
    const visited = await git({ args: ['rev-parse', 'HEAD'], cwd: main })
    await git({ args: ['checkout', 'main'], cwd: main })
    await writeFile(join(main, 'README.md'), 'stash one\n')
    await git({ args: ['stash', 'push', '-m', 'one'], cwd: main })
    const firstStash = await git({ args: ['rev-parse', 'refs/stash'], cwd: main })
    await writeFile(join(main, 'README.md'), 'stash two\n')
    await git({ args: ['stash', 'push', '-m', 'two'], cwd: main })
    const secondStash = await git({ args: ['rev-parse', 'refs/stash'], cwd: main })
    const ownedBefore = await git({ args: ['for-each-ref', '--format=%(refname)'], cwd: main })
    const archivePath = await capturePlain({ cwd: main })

    const { destination } = await cloudRestore(archivePath)

    await git({ args: ['fsck', '--no-dangling'], cwd: destination })
    expect(await git({ args: ['cat-file', '-t', visited], cwd: destination })).toBe('commit')
    expect(await reflogShas({ cwd: destination, ref: 'HEAD' })).toContain(visited)
    expect(await git({ args: ['stash', 'list', '--format=%H'], cwd: destination })).toBe(`${secondStash}\n${firstStash}`)
    expect(await git({ args: ['rev-parse', '--verify', '--quiet', 'refs/heads/uncovered-visit'], cwd: destination }).catch(() => 'absent')).toBe('absent')
    expect(ownedBefore).toContain('refs/heads/uncovered-visit')
    expect(await git({ args: ['for-each-ref', '--format=%(refname)', 'refs/heads/'], cwd: destination })).toBe('refs/heads/main')
    expect(await git({ args: ['reflog', 'show', 'refs/heads/unrelated-branch'], cwd: destination }).catch(() => 'absent')).toBe('absent')
    expect(await readdir(join(destination, '.git', 'logs', 'refs', 'heads'))).toEqual(['main'])
  })

  it('keeps each linked checkout\'s private HEAD reflog objects independent', async () => {
    const made = await createFamilyFixture()
    const visits: Record<string, string> = {}
    for (const member of ['a', 'b'] as const) {
      const { path, branch } = made.checkouts[member]
      await git({ args: ['checkout', '--detach'], cwd: path })
      await writeFile(join(path, `detached-${member}.txt`), `${member}\n`)
      await git({ args: ['add', '-A'], cwd: path })
      await git({ args: ['commit', '-m', `detached ${member}`], cwd: path })
      visits[member] = await git({ args: ['rev-parse', 'HEAD'], cwd: path })
      await git({ args: ['checkout', branch], cwd: path })
    }
    const archivePath = await capturePlain({ cwd: made.main, family: made.family })

    const { destination, restored } = await cloudRestore(archivePath)

    await git({ args: ['fsck', '--no-dangling'], cwd: destination })
    for (const member of ['a', 'b'] as const) {
      const path = restored.trees.find((tree) => tree.sourcePath === made.checkouts[member].path)?.path ?? ''
      const other = member === 'a' ? 'b' : 'a'
      const shas = await reflogShas({ cwd: path, ref: 'HEAD' })
      expect(shas).toContain(visits[member] ?? 'missing')
      expect(shas).not.toContain(visits[other] ?? 'missing')
      expect(await git({ args: ['cat-file', '-t', visits[member] ?? ''], cwd: path })).toBe('commit')
    }
    const packs = (await readdir(join(destination, '.git', 'objects', 'pack'))).filter((name) => name.endsWith('.pack'))
    expect(packs).toHaveLength(1)
  })

  it('does not carry objects only an uncovered branch reflog references', async () => {
    const made = await createFamilyFixture()
    const orphan = await git({ args: ['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'only in uncovered log'], cwd: made.main })
    await git({ args: ['update-ref', '--create-reflog', 'refs/heads/side-only', orphan], cwd: made.main })
    const archivePath = await capturePlain({ cwd: made.main })

    const { destination } = await cloudRestore(archivePath)

    await git({ args: ['fsck', '--no-dangling'], cwd: destination })
    expect(await git({ args: ['cat-file', '-t', orphan], cwd: destination }).catch(() => 'absent')).toBe('absent')
    expect(await git({ args: ['for-each-ref', '--format=%(refname)', 'refs/heads/'], cwd: destination })).toBe('refs/heads/main')
  })
})
