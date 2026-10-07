import { afterEach, expect, it } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { toThreadId, worktreeLockToken } from '@dltech/atlas-core'

import { createIsolatedContainer } from '../../container/injection'
import { CountingIds, openStoreFixture, type StoreFixture } from '../../store/__tests__/harness'
import { startTimeOf } from '../../workspace/process-identity'
import { listWorktrees, lockWorktree } from '../../workspace/worktrees'
import { git } from '../../workspace/transfer/__tests__/capture-fixture'
import { claimOpenedWorktree, releaseEndedWorktree } from '../worktree-claims'
import { recordingNotices } from './fakes'

const stores: StoreFixture[] = []
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close()
})

it('keeps an inherited parent lock when relocated home and active directories differ', async () => {
  const store = openStoreFixture()
  stores.push(store)
  const repository = join(store.home, 'repo')
  const tree = join(repository, '.atlas', 'worktrees', 'parent')
  await mkdir(repository)
  await git({ cwd: repository, args: ['init', '-b', 'main'] })
  await writeFile(join(repository, 'file'), 'seed\n')
  await git({ cwd: repository, args: ['add', '.'] })
  await git({ cwd: repository, args: ['commit', '-m', 'seed'] })
  await git({ cwd: repository, args: ['worktree', 'add', '-b', 'parent', tree] })
  const parent = toThreadId('brn_parent_lock')
  const child = toThreadId('brn_child_lock')
  const ids = new CountingIds('family-lock')
  await store.threads.createWithFirstEvents({
    threadId: parent, runId: ids.nextRunId(), workspace: repository, repo: repository,
    drafts: [{ type: 'user-said', text: 'parent' }, { type: 'worktree-entered', path: tree, branch: 'parent', adopted: true }],
  })
  await store.threads.createWithFirstEvents({
    threadId: child, runId: ids.nextRunId(), workspace: tree, repo: repository,
    agent: { spawnedBy: parent, type: 'teammate' }, drafts: [{ type: 'user-said', text: 'inherited' }],
  })
  const reason = worktreeLockToken({ label: `thread ${parent}`, identity: { pid: process.pid, start: await startTimeOf({ pid: process.pid }) } })
  await lockWorktree({ cwd: repository, path: tree, reason })
  const locked = async () => {
    const listed = await listWorktrees({ cwd: repository })
    if (!listed.ok) throw new Error(listed.message)
    return listed.worktrees.find((item) => item.path === tree)?.lockedReason
  }
  await claimOpenedWorktree({ container: createIsolatedContainer(), threads: store.threads, log: store.log, threadId: child, projectDirectory: tree, notice: recordingNotices().port })
  expect(await locked()).toBe(reason)
  await releaseEndedWorktree({ threads: store.threads, log: store.log, threadId: child })
  expect(await locked()).toBe(reason)
})
