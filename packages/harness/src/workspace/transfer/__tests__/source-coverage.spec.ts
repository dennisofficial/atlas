import { mkdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { discoverLayout } from '../capture-layout'
import type { WorkspaceManifest } from '../manifest'
import { requireCoveredSourceWorktrees } from '../source-coverage'
import { cleanupScratches, createScratch, git } from './capture-fixture'

afterEach(cleanupScratches)

type Repository = { scratch: string; main: string; active: string; peer: string }

const createRepository = async (): Promise<Repository> => {
  const scratch = await createScratch()
  const main = join(scratch, 'repo')
  await mkdir(main, { recursive: true })
  await git({ args: ['init', '-b', 'main'], cwd: main })
  await writeFile(join(main, '.gitignore'), '.atlas/\n')
  await writeFile(join(main, 'app.ts'), 'export const one = 1\n')
  await git({ args: ['add', '-A'], cwd: main })
  await git({ args: ['commit', '-m', 'seed'], cwd: main })
  return {
    scratch,
    main,
    active: join(main, '.atlas', 'worktrees', 'active'),
    peer: join(main, '.atlas', 'worktrees', 'peer'),
  }
}

const manifestOf = async ({ cwd }: { cwd: string }): Promise<WorkspaceManifest> => {
  const layout = await discoverLayout({ cwd })
  return {
    version: 1,
    repository: layout.repository,
    activeId: layout.activeId,
    activeRelativePath: layout.activeRelativePath,
    trees: layout.trees.map(({ excludedRoots: _excluded, ...tree }) => ({ ...tree, fingerprint: 'f' })),
  }
}

const addPeerWithWork = async ({ main, peer }: Repository): Promise<void> => {
  await git({ args: ['worktree', 'add', peer, '-b', 'peer-work'], cwd: main })
  await writeFile(join(peer, 'unpublished.ts'), 'export const unpublished = true\n')
  await git({ args: ['add', 'unpublished.ts'], cwd: peer })
  await git({ args: ['commit', '-m', 'unpublished peer commit'], cwd: peer })
  await writeFile(join(peer, 'dirty.txt'), 'uncommitted peer edit\n')
  await mkdir(join(peer, '.atlas', 'children'), { recursive: true })
  await writeFile(join(peer, '.atlas', 'children', 'finished.log'), 'finished child output\n')
}

describe('requiring every registered checkout to be covered by the archive', () => {
  it('passes a plain directory without a repository', async () => {
    const scratch = await createScratch()

    await requireCoveredSourceWorktrees({ cwd: scratch })
    await requireCoveredSourceWorktrees({ cwd: scratch, manifest: await manifestOf({ cwd: scratch }) })
  })

  it('passes a repository whose only checkout is main', async () => {
    const { main } = await createRepository()

    await requireCoveredSourceWorktrees({ cwd: main })
    await requireCoveredSourceWorktrees({ cwd: main, manifest: await manifestOf({ cwd: main }) })
  })

  it('passes main plus the active worktree when nothing else is registered', async () => {
    const repository = await createRepository()
    await git({ args: ['worktree', 'add', repository.active, '-b', 'active'], cwd: repository.main })

    await requireCoveredSourceWorktrees({ cwd: repository.active })
    await requireCoveredSourceWorktrees({ cwd: repository.active, manifest: await manifestOf({ cwd: repository.active }) })
  })

  it('refuses a dirty unpublished peer, names it, and leaves it intact', async () => {
    const repository = await createRepository()
    await git({ args: ['worktree', 'add', repository.active, '-b', 'active'], cwd: repository.main })
    await addPeerWithWork(repository)
    const peerHead = await git({ args: ['rev-parse', 'peer-work'], cwd: repository.main })
    const peerPath = await git({ args: ['rev-parse', '--show-toplevel'], cwd: repository.peer })

    const refusal = requireCoveredSourceWorktrees({ cwd: repository.active })

    await expect(refusal).rejects.toThrow(peerPath)
    await expect(refusal).rejects.toThrow('stays in the cloud session')
    await expect(refusal).rejects.toThrow('no work was removed')
    expect(await readFile(join(repository.peer, 'dirty.txt'), 'utf8')).toBe('uncommitted peer edit\n')
    expect(await readFile(join(repository.peer, '.atlas', 'children', 'finished.log'), 'utf8')).toBe(
      'finished child output\n',
    )
    expect(await git({ args: ['rev-parse', 'peer-work'], cwd: repository.main })).toBe(peerHead)
  })

  it('refuses an omitted checkout even when it is clean and published', async () => {
    const repository = await createRepository()
    await git({ args: ['worktree', 'add', repository.peer, '-b', 'peer-clean'], cwd: repository.main })

    await expect(requireCoveredSourceWorktrees({ cwd: repository.main })).rejects.toThrow('peer')
  })

  it('refuses against the actual manifest when a sibling appeared after the first check', async () => {
    const repository = await createRepository()
    const manifest = await manifestOf({ cwd: repository.main })
    await git({ args: ['worktree', 'add', repository.peer, '-b', 'late-peer'], cwd: repository.main })

    await expect(requireCoveredSourceWorktrees({ cwd: repository.main, manifest })).rejects.toThrow('peer')
  })

  it('compares exact roots, so a sibling nested below a covered main still refuses', async () => {
    const repository = await createRepository()
    await git({ args: ['worktree', 'add', repository.peer, '-b', 'nested'], cwd: repository.main })
    const manifest = await manifestOf({ cwd: repository.main })

    expect(manifest.trees.map((tree) => tree.sourcePath)).toEqual([repository.main])
    await expect(requireCoveredSourceWorktrees({ cwd: repository.main, manifest })).rejects.toThrow('peer')
  })

  it('treats a symlinked alias of a covered root as the same canonical root', async () => {
    const repository = await createRepository()
    await git({ args: ['worktree', 'add', repository.active, '-b', 'active'], cwd: repository.main })
    const alias = join(repository.scratch, 'alias')
    await symlink(repository.main, alias)
    expect(await readlink(alias)).toBe(repository.main)
    const manifest = await manifestOf({ cwd: repository.active })
    const aliased: WorkspaceManifest = {
      ...manifest,
      trees: manifest.trees.map((tree) =>
        tree.isMain ? { ...tree, sourcePath: alias } : { ...tree, sourcePath: join(alias, '.atlas', 'worktrees', 'active') },
      ),
    }

    await requireCoveredSourceWorktrees({ cwd: join(alias, '.atlas', 'worktrees', 'active'), manifest: aliased })
    await requireCoveredSourceWorktrees({ cwd: repository.active, manifest: aliased })
  })

  it('fails closed when the directory cannot be inspected', async () => {
    const scratch = await createScratch()

    await expect(requireCoveredSourceWorktrees({ cwd: join(scratch, 'missing') })).rejects.toThrow(
      'Cannot confirm that every checkout',
    )
  })

  it('fails closed when a manifest root cannot be resolved', async () => {
    const { main } = await createRepository()
    const manifest = await manifestOf({ cwd: main })
    const broken: WorkspaceManifest = {
      ...manifest,
      trees: manifest.trees.map((tree) => ({ ...tree, sourcePath: join(main, 'vanished') })),
    }

    await expect(requireCoveredSourceWorktrees({ cwd: main, manifest: broken })).rejects.toThrow(
      'Cannot confirm that every checkout',
    )
  })
})
