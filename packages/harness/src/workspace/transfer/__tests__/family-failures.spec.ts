import { afterEach, describe, expect, it } from 'bun:test'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { captureWorkspaceArchive } from '../capture'
import { assertFamilyManifest, isSafeRelativePath, workspaceFamilySchema } from '../family-manifest'
import type { WorkspaceFamilyCapture } from '../manifest'
import { cleanupScratches, createFamilyFixture, createScratch, git } from './family-fixture'

afterEach(cleanupScratches)

const attempt = async ({ cwd, family }: { cwd: string; family: WorkspaceFamilyCapture }): Promise<Error> => {
  const destination = join(await createScratch(), 'workspace.tar.gz')
  return captureWorkspaceArchive({ cwd, destination, family }).then(
    () => {
      throw new Error('capture unexpectedly succeeded')
    },
    (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
  )
}

const gitDirOf = (cwd: string): Promise<string> => git({ args: ['rev-parse', '--absolute-git-dir'], cwd })

describe('family capture refusals', () => {
  it('refuses a checkout recreated under the same path as a new generation', async () => {
    const made = await createFamilyFixture()
    const { path } = made.checkouts.b
    await git({ args: ['worktree', 'remove', '--force', path], cwd: made.main })
    await git({ args: ['worktree', 'add', path, 'br-b'], cwd: made.main })

    const error = await attempt({ cwd: made.main, family: made.family })

    expect(error.message).toContain('is not generation chk-b')
  })

  it('refuses a checkout whose marker was rewritten to another generation', async () => {
    const made = await createFamilyFixture()
    await writeFile(join(await gitDirOf(made.checkouts.c.path), 'atlas-checkout-id'), 'chk-other\n')

    const error = await attempt({ cwd: made.main, family: made.family })

    expect(error.message).toContain('is not generation chk-c')
  })

  it('refuses a selected checkout that disappeared from disk', async () => {
    const made = await createFamilyFixture()
    await rm(made.checkouts.d.path, { recursive: true, force: true })

    const error = await attempt({ cwd: made.main, family: made.family })

    expect(error.message).toContain('no longer exists')
  })

  it('refuses a checkout that is no longer registered', async () => {
    const made = await createFamilyFixture()
    await git({ args: ['worktree', 'remove', '--force', made.checkouts.e.path], cwd: made.main })
    await git({ args: ['worktree', 'add', made.checkouts.e.path, 'br-e'], cwd: made.main })
    await git({ args: ['worktree', 'remove', '--force', made.checkouts.e.path], cwd: made.main })
    await git({ args: ['worktree', 'prune'], cwd: made.main })
    await git({ args: ['worktree', 'add', join(made.scratch, 'elsewhere'), 'br-e'], cwd: made.main })

    const error = await attempt({ cwd: made.main, family: made.family })

    expect(error.message).toMatch(/no longer exists|no longer a registered/)
  })

  it('never implicitly claims an unrelated registered checkout as a home or active tree', async () => {
    const made = await createFamilyFixture()
    const threads = [...made.family.threads, { threadId: 't-x', home: made.unrelated, active: null }]

    const homeError = await attempt({ cwd: made.main, family: { ...made.family, threads } })
    const activeError = await attempt({
      cwd: made.main,
      family: {
        ...made.family,
        threads: [
          ...made.family.threads,
          { threadId: 't-y', home: made.main, active: { path: made.unrelated, branch: 'unrelated-branch', base: undefined, adopted: false } },
        ],
      },
    })

    expect(homeError.message).toContain('which the family does not own')
    expect(activeError.message).toContain('which the family does not own')
  })

  it('refuses an initiating directory inside an unowned checkout', async () => {
    const made = await createFamilyFixture()

    const error = await attempt({ cwd: made.unrelated, family: made.family })

    expect(error.message).toContain('which the family does not own')
  })

  it('refuses a checkout listed twice with different generations', async () => {
    const made = await createFamilyFixture()
    const checkouts = [...made.family.checkouts, { id: 'chk-zzz', path: made.checkouts.a.path, claimedBy: 't-a' }]

    const error = await attempt({ cwd: made.main, family: { ...made.family, checkouts } })

    expect(error.message).toContain('inconsistently')
  })

  it('refuses a family whose root thread is missing', async () => {
    const made = await createFamilyFixture()
    const threads = made.family.threads.filter((thread) => thread.threadId !== 'root')

    const error = await attempt({ cwd: made.main, family: { ...made.family, threads } })

    expect(error.message).toContain('no thread for its root')
  })

  it('keeps legacy unusable-registry policy when no family is given', async () => {
    const made = await createFamilyFixture()
    await rm(made.unrelated, { recursive: true, force: true })
    const destination = join(await createScratch(), 'workspace.tar.gz')

    await expect(captureWorkspaceArchive({ cwd: made.main, destination })).rejects.toThrow('prunable')
    const withFamily = await captureWorkspaceArchive({ cwd: made.main, destination, family: made.family })

    expect(withFamily.trees).toHaveLength(6)
  })
})

describe('family manifest validation', () => {
  const trees = [
    { id: 'main', isMain: true },
    { id: 'wt_1', isMain: false },
  ]
  const valid = {
    rootId: 'root',
    checkouts: [{ id: 'c1', treeId: 'wt_1', claimedBy: 'root' }],
    threads: [{ threadId: 'root', home: { treeId: 'main', relativePath: '' }, active: null }],
  }

  it.each(['/abs', '../up', 'a/../b', 'a\\b', 'C:/x', 'a//b', './a', 'nul\0'])('rejects the unsafe home path %p', (path) => {
    expect(isSafeRelativePath(path)).toBe(false)
    const parsed = workspaceFamilySchema.safeParse({ ...valid, threads: [{ ...valid.threads[0], home: { treeId: 'main', relativePath: path } }] })
    expect(parsed.success).toBe(false)
  })

  it('accepts nested relative home paths and the empty path', () => {
    expect(isSafeRelativePath('pkg/sub')).toBe(true)
    expect(isSafeRelativePath('')).toBe(true)
  })

  it('rejects duplicate checkouts, threads and trees, a missing root and mappings to omitted trees', () => {
    const problem = (family: unknown): string => {
      try {
        assertFamilyManifest({ trees, family: workspaceFamilySchema.parse(family), plain: false })
        return 'accepted'
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }
    expect(problem(valid)).toBe('accepted')
    expect(problem({ ...valid, checkouts: [...valid.checkouts, { id: 'c1', treeId: 'wt_1', claimedBy: 'x' }] })).toContain('repeats checkout')
    expect(problem({ ...valid, checkouts: [...valid.checkouts, { id: 'c2', treeId: 'wt_1', claimedBy: 'x' }] })).toContain('two checkouts')
    expect(problem({ ...valid, threads: [...valid.threads, valid.threads[0]] })).toContain('repeats thread')
    expect(problem({ ...valid, rootId: 'other' })).toContain('no thread for its root')
    expect(problem({ ...valid, checkouts: [{ id: 'c1', treeId: 'main', claimedBy: 'x' }] })).toContain('not a linked tree')
    expect(problem({ ...valid, checkouts: [{ id: 'c1', treeId: 'gone', claimedBy: 'x' }] })).toContain('not a linked tree')
    expect(problem({ ...valid, threads: [{ threadId: 'root', home: { treeId: 'wt_9', relativePath: '' }, active: null }] })).toContain('unowned tree')
    const unclaimed = { ...valid, checkouts: [] }
    expect(problem({ ...unclaimed, threads: [{ threadId: 'root', home: { treeId: 'main', relativePath: '' }, active: { treeId: 'wt_1', base: null, adopted: false } }] })).toContain('unowned tree')
  })
})
