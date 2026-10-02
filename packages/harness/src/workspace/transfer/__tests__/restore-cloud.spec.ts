import { afterAll, describe, expect, it } from 'bun:test'
import { lstat, mkdir, readFile, readlink, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { workspaceReceiptSchema } from '../manifest'
import { EWorkspaceRestoreMode, restoreWorkspaceArchive } from '../restore'
import {
  archiveOf,
  cleanup,
  fixture,
  git,
  scratch,
  status,
  worktreePaths,
} from './restore-fixture'

afterAll(cleanup)

const cloudRestore = async ({ archivePath }: { archivePath: string }) => {
  const destination = join(await scratch(), 'cloud')
  const restored = await restoreWorkspaceArchive({
    archivePath,
    destination,
    mode: EWorkspaceRestoreMode.Cloud,
  })
  return { destination, restored }
}

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

describe('restoreWorkspaceArchive in cloud mode', () => {
  it('restores the active worktree with staged, unstaged and untracked state and leaves ignored files behind', async () => {
    const made = await fixture()
    await writeFile(join(made.main, 'both.txt'), 'one\n')
    await git({ args: ['add', 'both.txt'], cwd: made.main })
    await writeFile(join(made.main, 'both.txt'), 'two\n')
    await writeFile(join(made.main, 'tracked.log'), 'tracked\n')
    await git({ args: ['add', '-f', 'tracked.log'], cwd: made.main })
    const { archivePath } = await archiveOf({ cwd: made.main })

    const { destination, restored } = await cloudRestore({ archivePath })

    expect(restored.cwd).toBe(destination)
    expect(restored.repository).toBe(destination)
    expect(restored.trees.map((tree) => tree.path)).toEqual([destination])
    expect(restored.trees[0]).toMatchObject({ sourcePath: made.main, branch: 'main', renamedFrom: null })

    expect(await status(destination)).toBe(await status(made.main))
    expect(await git({ args: ['diff', '--cached'], cwd: destination })).toBe(
      await git({ args: ['diff', '--cached'], cwd: made.main }),
    )
    expect(await git({ args: ['diff'], cwd: destination })).toBe(await git({ args: ['diff'], cwd: made.main }))
    expect(await readFile(join(destination, 'both.txt'), 'utf8')).toBe('two\n')
    expect(await git({ args: ['show', ':both.txt'], cwd: destination })).toBe('one')
    expect(await readFile(join(destination, 'tracked.log'), 'utf8')).toBe('tracked\n')

    expect(await exists(join(destination, 'node_modules'))).toBe(false)
    expect(await exists(join(destination, 'debug.log'))).toBe(false)
    expect(await readlink(join(destination, 'link-to-app'))).toBe('src/app.ts')
    expect(await readlink(join(destination, 'dangling'))).toBe('does-not-exist')
    expect((await lstat(join(destination, 'empty-dir'))).isDirectory()).toBe(true)
    expect((await stat(join(destination, 'bin', 'run.sh'))).mode & 0o111).not.toBe(0)

    expect(await worktreePaths(destination)).toEqual([destination])
    expect(await git({ args: ['branch', '--list', 'feat'], cwd: destination })).toContain('feat')
    await git({ args: ['fsck', '--no-dangling'], cwd: destination })
  })

  it('restores ignored paths that .atlas/.cloudinclude force-included at capture', async () => {
    const made = await fixture()
    await mkdir(join(made.main, '.atlas'), { recursive: true })
    await writeFile(join(made.main, '.atlas', '.cloudinclude'), '.atlas/\nnode_modules/\n')
    const { archivePath } = await archiveOf({ cwd: made.main })

    const { destination } = await cloudRestore({ archivePath })

    expect(await readFile(join(destination, 'node_modules', 'pkg', 'index.js'), 'utf8')).toBe('module.exports = 1\n')
    expect(await readFile(join(destination, '.atlas', '.cloudinclude'), 'utf8')).toContain('node_modules/')
    expect(await exists(join(destination, 'debug.log'))).toBe(false)
  })

  it('restores a workspace whose only force-include rule is for node_modules under a gitignored .atlas/', async () => {
    const made = await fixture()
    await mkdir(join(made.main, '.atlas'), { recursive: true })
    await writeFile(join(made.main, '.atlas', '.cloudinclude'), 'node_modules/\n')
    const { archivePath } = await archiveOf({ cwd: made.main })

    const { destination } = await cloudRestore({ archivePath })

    expect(await readFile(join(destination, 'node_modules', 'pkg', 'index.js'), 'utf8')).toBe('module.exports = 1\n')
    expect(await readFile(join(destination, '.atlas', '.cloudinclude'), 'utf8')).toBe('node_modules/\n')
  })

  it('writes a receipt that keeps the origin paths and falls back to fingerprints as baselines', async () => {
    const made = await fixture()
    const { archivePath, manifest } = await archiveOf({ cwd: made.main })
    const { destination } = await cloudRestore({ archivePath })

    const receipt = workspaceReceiptSchema.parse(
      JSON.parse(await readFile(join(destination, '.git', 'atlas-transfer.json'), 'utf8')),
    )
    expect(receipt.repositoryOrigin).toBe(made.main)
    const main = manifest.trees.find((tree) => tree.isMain)
    expect(receipt.trees.find((entry) => entry.path === destination)).toMatchObject({
      id: main?.id,
      originPath: made.main,
      baseline: main?.fingerprint,
    })
    expect(receipt.trees).toHaveLength(1)
  })

  it('opens the restored session in the active tree and subdirectory', async () => {
    const made = await fixture()
    const { archivePath } = await archiveOf({ cwd: join(made.main, 'src') })
    const { destination, restored } = await cloudRestore({ archivePath })
    expect(restored.cwd).toBe(join(destination, 'src'))
  })

  it('restores a capture taken from inside a linked worktree and opens the session in its subdirectory', async () => {
    const made = await fixture()
    const { archivePath } = await archiveOf({ cwd: join(made.nested, 'pkg', 'sub') })
    const { restored } = await cloudRestore({ archivePath })
    expect(restored.cwd.endsWith(join('pkg', 'sub'))).toBe(true)
    expect(await readFile(join(restored.cwd, 'deep.txt'), 'utf8')).toBe('deep\n')
    expect(restored.trees).toHaveLength(1)
    expect(restored.trees[0]).toMatchObject({ sourcePath: made.nested, branch: 'feat' })
  })

  it('never runs hooks stored in the archive', async () => {
    const made = await fixture()
    const marker = join(await scratch(), 'hook-ran')
    for (const hook of ['reference-transaction', 'post-checkout', 'post-index-change']) {
      await writeFile(join(made.main, '.git', 'hooks', hook), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 })
    }
    const { archivePath } = await archiveOf({ cwd: made.main })
    await cloudRestore({ archivePath })
    expect(await stat(marker).then(() => true, () => false)).toBe(false)
  })
})
