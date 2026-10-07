import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { EWorktreeExit, toThreadId } from '@dltech/atlas-core'

import { CountingIds, openStoreFixture, type StoreFixture } from '../../../store/__tests__/harness'
import { captureWorkspaceFamily } from '../family-snapshot'
import { git } from './capture-fixture'

const stores: StoreFixture[] = []
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close()
})

async function fixture() {
  const store = openStoreFixture()
  stores.push(store)
  const main = join(store.home, 'repository')
  await mkdir(main)
  await git({ cwd: main, args: ['init', '-b', 'main'] })
  await writeFile(join(main, '.gitignore'), '.atlas/\n')
  await writeFile(join(main, 'file'), 'seed\n')
  await git({ cwd: main, args: ['add', '.'] })
  await git({ cwd: main, args: ['commit', '-m', 'seed'] })
  const root = toThreadId('brn_snapshot_root')
  const ids = new CountingIds('snapshot')
  await store.threads.createWithFirstEvents({ threadId: root, runId: ids.nextRunId(), workspace: main, repo: main, drafts: [{ type: 'user-said', text: 'root' }] })
  const child = toThreadId('brn_snapshot_child')
  const childTree = join(main, '.atlas', 'worktrees', 'child')
  await git({ cwd: main, args: ['worktree', 'add', '-b', 'child', childTree] })
  await store.threads.createWithFirstEvents({ threadId: child, runId: ids.nextRunId(), workspace: main, repo: main, agent: { spawnedBy: root, type: 'teammate' }, drafts: [{ type: 'user-said', text: 'child' }, { type: 'worktree-entered', path: childTree, branch: 'child', adopted: true }] })
  const retained = toThreadId('brn_snapshot_retained')
  const retainedTree = join(main, '.atlas', 'worktrees', 'retained')
  await git({ cwd: main, args: ['worktree', 'add', '-b', 'retained', retainedTree] })
  await store.threads.createWithFirstEvents({ threadId: retained, runId: ids.nextRunId(), workspace: main, repo: main, agent: { spawnedBy: root, type: 'teammate' }, drafts: [{ type: 'user-said', text: 'retained' }, { type: 'worktree-entered', path: retainedTree, branch: 'retained', adopted: true }, { type: 'worktree-exited', path: retainedTree, action: EWorktreeExit.Keep }] })
  const unrelated = join(main, '.atlas', 'worktrees', 'unrelated')
  await git({ cwd: main, args: ['worktree', 'add', '-b', 'unrelated', unrelated] })
  const snapshot = () => captureWorkspaceFamily({ threadId: root, cwd: main, log: store.log, threads: store.threads, sessionDir: join(store.home, 'sessions', root) })
  return { store, main, root, ids, child, childTree, retained, retainedTree, unrelated, snapshot }
}

describe('family capture snapshot from durable session state', () => {
  it('includes retained exited checkouts and excludes unrelated registry entries', async () => {
    const made = await fixture()
    const captured = await made.snapshot()
    expect(captured?.checkouts.map((checkout) => checkout.path).sort()).toEqual([made.childTree, made.retainedTree].sort())
    expect(captured?.checkouts.map((checkout) => checkout.path)).not.toContain(made.unrelated)
    expect(captured?.threads.find((thread) => thread.threadId === made.retained)).toMatchObject({ home: made.main, active: null })
    expect(captured?.threads.find((thread) => thread.threadId === made.child)).toMatchObject({ home: made.main, active: { path: made.childTree, adopted: true } })
  })

  it('deduplicates a checkout shared by inherited descendants without changing its generation', async () => {
    const made = await fixture()
    const before = await made.snapshot()
    const nested = toThreadId('brn_snapshot_nested')
    await made.store.threads.createWithFirstEvents({ threadId: nested, runId: made.ids.nextRunId(), workspace: made.childTree, repo: made.main, agent: { spawnedBy: made.child, type: 'builder' }, drafts: [{ type: 'user-said', text: 'nested' }] })
    const after = await made.snapshot()
    expect(after?.checkouts).toEqual(before?.checkouts)
    expect(after?.threads.map((thread) => thread.threadId)).toContain(nested)
    expect(after?.threads.find((thread) => thread.threadId === nested)?.home).toBe(made.childTree)
  })

  it('does not reconstruct a removed retained generation or adopt its same-path replacement', async () => {
    const made = await fixture()
    await git({ cwd: made.main, args: ['worktree', 'remove', made.retainedTree] })
    expect((await made.snapshot())?.checkouts.map((checkout) => checkout.path)).not.toContain(made.retainedTree)
    await git({ cwd: made.main, args: ['worktree', 'add', '-b', 'replacement', made.retainedTree] })
    expect((await made.snapshot())?.checkouts.map((checkout) => checkout.path)).not.toContain(made.retainedTree)
    expect((await made.snapshot())?.threads.find((thread) => thread.threadId === made.retained)?.home).toBe(made.main)
  })

  it('refuses a vanished current active checkout instead of falling back to its ancestor', async () => {
    const made = await fixture()
    const before = await made.store.log.readOwn({ threadId: made.child })
    await git({ cwd: made.main, args: ['worktree', 'remove', made.childTree] })
    await expect(made.snapshot()).rejects.toThrow()
    expect(await made.store.log.readOwn({ threadId: made.child })).toEqual(before)
  })
})
