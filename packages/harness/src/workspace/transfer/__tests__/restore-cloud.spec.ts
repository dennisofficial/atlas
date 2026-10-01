import { afterAll, describe, expect, it } from 'bun:test'
import { lstat, readFile, readlink, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { workspaceReceiptSchema } from '../manifest'
import { EWorkspaceRestoreMode, restoreWorkspaceArchive } from '../restore'
import {
  archiveOf,
  cleanup,
  fixture,
  git,
  headOf,
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

describe('restoreWorkspaceArchive in cloud mode', () => {
  it('restores every worktree with staged, unstaged, untracked and ignored state', async () => {
    const made = await fixture()
    await writeFile(join(made.main, 'both.txt'), 'one\n')
    await git({ args: ['add', 'both.txt'], cwd: made.main })
    await writeFile(join(made.main, 'both.txt'), 'two\n')
    const { archivePath } = await archiveOf({ cwd: made.main })

    const { destination, restored } = await cloudRestore({ archivePath })
    const nested = join(destination, '.atlas', 'worktrees', 'feat')
    const detached = join(destination, '.atlas', 'worktrees', 'detached')

    expect(restored.cwd).toBe(destination)
    expect(restored.repository).toBe(destination)
    expect(restored.trees.map((tree) => tree.path).sort()).toEqual([destination, detached, nested].sort())
    expect(restored.trees.find((tree) => tree.path === nested)).toMatchObject({
      sourcePath: made.nested,
      branch: 'feat',
      renamedFrom: null,
    })

    expect(await status(destination)).toBe(await status(made.main))
    expect(await status(nested)).toBe(await status(made.nested))
    expect(await status(detached)).toBe(await status(made.detached))
    expect(await git({ args: ['diff', '--cached'], cwd: destination })).toBe(
      await git({ args: ['diff', '--cached'], cwd: made.main }),
    )
    expect(await git({ args: ['diff'], cwd: destination })).toBe(await git({ args: ['diff'], cwd: made.main }))
    expect(await readFile(join(destination, 'both.txt'), 'utf8')).toBe('two\n')
    expect(await git({ args: ['show', ':both.txt'], cwd: destination })).toBe('one')

    expect(await readFile(join(destination, 'node_modules', 'pkg', 'index.js'), 'utf8')).toBe('module.exports = 1\n')
    expect(await readFile(join(destination, 'debug.log'), 'utf8')).toBe('ignored\n')
    expect(await readlink(join(destination, 'link-to-app'))).toBe('src/app.ts')
    expect(await readlink(join(destination, 'dangling'))).toBe('does-not-exist')
    expect((await lstat(join(destination, 'empty-dir'))).isDirectory()).toBe(true)
    expect((await stat(join(destination, 'bin', 'run.sh'))).mode & 0o111).not.toBe(0)
    expect(await readFile(join(nested, 'pkg', 'sub', 'deep.txt'), 'utf8')).toBe('deep\n')
    expect(await headOf(detached)).toBe(await headOf(made.detached))

    expect((await worktreePaths(destination)).sort()).toEqual([destination, detached, nested].sort())
    await git({ args: ['fsck', '--no-dangling'], cwd: destination })
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
    expect(receipt.trees).toHaveLength(3)
  })

  it('opens the restored session in the active tree and subdirectory', async () => {
    const made = await fixture()
    const { archivePath } = await archiveOf({ cwd: join(made.nested, 'pkg', 'sub') })
    const { destination, restored } = await cloudRestore({ archivePath })
    expect(restored.cwd).toBe(join(destination, '.atlas', 'worktrees', 'feat', 'pkg', 'sub'))
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
