import { afterAll, describe, expect, it } from 'bun:test'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { EWorkspaceRestoreMode, restoreWorkspaceArchive } from '../restore'
import { archiveOf, cleanup, fixture, git, scratch, status } from './restore-fixture'

afterAll(cleanup)

const lifted = async () => {
  const made = await fixture()
  const first = await archiveOf({ cwd: made.main })
  const cloud = join(await scratch(), 'cloud')
  await restoreWorkspaceArchive({ archivePath: first.archivePath, destination: cloud, mode: EWorkspaceRestoreMode.Cloud })
  await writeFile(join(cloud, 'from-cloud.txt'), 'cloud\n')
  const back = await archiveOf({ cwd: cloud })
  return { made, back }
}

const once = (action: (path: string) => Promise<void>): ((path: string) => Promise<void>) => {
  let fired = false
  return async (path) => {
    if (fired) return
    fired = true
    await action(path)
  }
}

const restoreWith = ({ archivePath, destination, beforeSweep }: { archivePath: string; destination: string; beforeSweep: (path: string) => Promise<void> }) =>
  restoreWorkspaceArchive({ archivePath, destination, mode: EWorkspaceRestoreMode.Host, suffix: () => 'e5e5', beforeSweep })

describe('a host edit that lands after the plan was checked but before the originals move', () => {
  it('keeps a file added in that window and restores into a suffixed copy', async () => {
    const { made, back } = await lifted()

    const restored = await restoreWith({
      archivePath: back.archivePath,
      destination: made.main,
      beforeSweep: once((path) => writeFile(join(path, 'typed-in-window.txt'), 'precious\n')),
    })

    expect(await readFile(join(made.main, 'typed-in-window.txt'), 'utf8')).toBe('precious\n')
    expect(await readFile(join(made.main, 'README.md'), 'utf8')).toBe('hello, edited\n')
    expect(restored.cwd).toBe(join(made.main, '.atlas', 'worktrees', 'main-e5e5'))
    expect(await readFile(join(restored.cwd, 'from-cloud.txt'), 'utf8')).toBe('cloud\n')
    expect(await status(made.main)).toContain('typed-in-window.txt')
  })

  it('keeps an edit to an existing file made in that window', async () => {
    const { made, back } = await lifted()

    const restored = await restoreWith({
      archivePath: back.archivePath,
      destination: made.main,
      beforeSweep: once((path) => writeFile(join(path, 'README.md'), 'edited in the window\n')),
    })

    expect(await readFile(join(made.main, 'README.md'), 'utf8')).toBe('edited in the window\n')
    expect(restored.cwd).not.toBe(made.main)
  })

  it('keeps the host intact when a file is deleted in that window', async () => {
    const { made, back } = await lifted()

    const restored = await restoreWith({
      archivePath: back.archivePath,
      destination: made.main,
      beforeSweep: once((path) => rm(join(path, 'untracked.txt'))),
    })

    expect(restored.cwd).not.toBe(made.main)
    expect(await git({ args: ['symbolic-ref', 'HEAD'], cwd: made.main })).toBe('refs/heads/main')
    expect(await readFile(join(made.main, 'README.md'), 'utf8')).toBe('hello, edited\n')
  })

  it('still restores in place when nothing changes in the window', async () => {
    const { made, back } = await lifted()
    let seen = 0

    const restored = await restoreWith({
      archivePath: back.archivePath,
      destination: made.main,
      beforeSweep: async () => {
        seen += 1
      },
    })

    expect(seen).toBeGreaterThan(0)
    expect(restored.cwd).toBe(made.main)
    expect(await readFile(join(made.main, 'from-cloud.txt'), 'utf8')).toBe('cloud\n')
  })
})
