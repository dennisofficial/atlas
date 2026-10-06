import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { activeWorktreeOf, EExecutionLocation, EWorktreeExit, homeDirectoryOf, projectDirectoryOf, toThreadId } from '@dltech/atlas-core'

import { CountingIds, openStoreFixture, type StoreFixture } from '../../../store/__tests__/harness'
import { git } from '../../../workspace/transfer/__tests__/capture-fixture'
import type { RestoredWorkspace } from '../../../workspace/transfer/manifest'
import { recordWorkspaceArrival } from '../workspace-arrival'

const held: StoreFixture[] = []
afterEach(async () => {
  for (const fixture of held.splice(0)) await fixture.close()
})

const root = toThreadId('brn_family_root')
const child = toThreadId('brn_family_child')
const ids = new CountingIds('family-arrival')

async function fixture() {
  const store = openStoreFixture()
  held.push(store)
  const repository = join(store.home, 'repository')
  const rootTree = join(repository, '.atlas', 'worktrees', 'root')
  const childTree = join(repository, '.atlas', 'worktrees', 'child-abcd')
  await mkdir(repository)
  await git({ cwd: repository, args: ['init', '-b', 'main'] })
  await writeFile(join(repository, 'file'), 'seed\n')
  await git({ cwd: repository, args: ['add', '.'] })
  await git({ cwd: repository, args: ['commit', '-m', 'seed'] })
  await git({ cwd: repository, args: ['worktree', 'add', '-b', 'root', rootTree] })
  await git({ cwd: repository, args: ['worktree', 'add', '-b', 'child-abcd', childTree] })
  await mkdir(join(rootTree, 'subdir'))
  for (const [path, marker] of [[rootTree, 'generation-root'], [childTree, 'generation-child']] as const) {
    const admin = await git({ cwd: path, args: ['rev-parse', '--absolute-git-dir'] })
    await writeFile(join(admin, 'atlas-checkout-id'), marker)
  }
  const restored = {
    cwd: rootTree, repository,
    trees: [
      { id: 'main', sourcePath: '/host/repo', path: repository, branch: 'main', renamedFrom: null },
      { id: 'root', sourcePath: '/host/repo/.atlas/worktrees/root', path: rootTree, branch: 'root', renamedFrom: null },
      { id: 'child', sourcePath: '/host/repo/.atlas/worktrees/child', path: childTree, branch: 'child-abcd', renamedFrom: 'child' },
    ],
    family: {
      rootId: root,
      checkouts: [
        { id: 'generation-root', path: rootTree, claimedBy: root },
        { id: 'generation-child', path: childTree, claimedBy: child },
      ],
      threads: [
        { threadId: root, home: repository, active: { path: rootTree, branch: 'root', base: 'origin/main', adopted: false } },
        { threadId: child, home: join(rootTree, 'subdir'), active: { path: childTree, branch: 'child-abcd', base: null, adopted: true } },
      ],
    },
  }
  await store.threads.createWithFirstEvents({ threadId: root, runId: ids.nextRunId(), workspace: '/host/repo', drafts: [{ type: 'user-said', text: 'root' }] })
  await store.threads.createWithFirstEvents({ threadId: child, runId: ids.nextRunId(), workspace: '/host/repo/.atlas/worktrees/root/subdir', agent: { spawnedBy: root, type: 'teammate' }, drafts: [{ type: 'user-said', text: 'child' }] })
  return { store, restored, rootTree, childTree, repository }
}

const arrive = (store: StoreFixture, restored: RestoredWorkspace) => recordWorkspaceArrival({
  threadId: root, from: EExecutionLocation.Host, to: EExecutionLocation.Cloud,
  restored, launchDirectory: '/host/repo', log: store.log, threads: store.threads, ids,
  sessionDir: join(store.home, 'sessions', root),
})

describe('explicit family workspace arrival', () => {
  it('preserves each thread home independently of its active checkout and preserves removal policy', async () => {
    const made = await fixture()
    const { store, restored, repository, rootTree, childTree } = made
    const original = await store.log.readOwn({ threadId: child })
    await arrive(store, restored)
    const parentEvents = await store.log.readOwn({ threadId: root })
    expect(homeDirectoryOf({ events: parentEvents, launchDirectory: '/wrong' })).toBe(repository)
    expect(projectDirectoryOf({ events: parentEvents, launchDirectory: '/wrong' })).toBe(restored.cwd)
    expect(activeWorktreeOf(parentEvents)).toMatchObject({ base: 'origin/main', adopted: false })
    const childEvents = await store.log.readOwn({ threadId: child })
    expect(childEvents[0]).toEqual(original[0])
    expect(homeDirectoryOf({ events: childEvents, launchDirectory: '/wrong' })).toBe(join(rootTree, 'subdir'))
    expect(activeWorktreeOf(childEvents)).toMatchObject({ path: childTree, branch: 'child-abcd', adopted: true })
    await store.log.append({ threadId: child, runId: ids.nextRunId(), drafts: [{ type: 'worktree-exited', path: childTree, action: EWorktreeExit.Keep }] })
    expect(projectDirectoryOf({ events: await store.log.readOwn({ threadId: child }), launchDirectory: '/wrong' })).toBe(join(rootTree, 'subdir'))
  })

  it('rejects an omitted child mapping before adopting or appending any member', async () => {
    const { store, restored } = await fixture()
    const before = await store.log.readOwn({ threadId: root })
    await expect(arrive(store, { ...restored, family: { ...restored.family, threads: restored.family.threads.slice(0, 1) } })).rejects.toThrow('mapping')
    expect(await store.log.readOwn({ threadId: root })).toEqual(before)
    expect((await store.threads.find({ threadId: root }))?.workspace).toBe('/host/repo')
  })

  it('keeps a retained exited checkout owned without synthesizing an active entry', async () => {
    const { store, restored, repository } = await fixture()
    const workspace = { ...restored, family: { ...restored.family, threads: restored.family.threads.map((entry) => entry.threadId === child ? { ...entry, home: repository, active: null } : entry) } }
    await arrive(store, workspace)
    const events = await store.log.readOwn({ threadId: child })
    expect(activeWorktreeOf(events)).toBeUndefined()
    expect(projectDirectoryOf({ events, launchDirectory: '/wrong' })).toBe(repository)
  })
})
