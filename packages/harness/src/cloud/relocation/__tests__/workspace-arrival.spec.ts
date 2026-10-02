import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation, projectDirectoryOf, toThreadId } from '@dltech/atlas-core'

import { CountingIds, openStoreFixture, type StoreFixture } from '../../../store/__tests__/harness'
import { runGit } from '../../../workspace/run-git'
import { recordWorkspaceArrival, workspaceArrivalDrafts } from '../workspace-arrival'

const held: StoreFixture[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const fixture of held.splice(0)) await fixture.close()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

const restored = {
  cwd: '/host/repo/.atlas/worktrees/feature-a7c2',
  repository: '/host/repo',
  trees: [{
    id: 'feature',
    sourcePath: '/atlas/workspace/.atlas/worktrees/feature',
    path: '/host/repo/.atlas/worktrees/feature-a7c2',
    branch: 'dennis/feature-a7c2',
    renamedFrom: 'feature',
  }],
}

describe('a restored worktree arrival', () => {
  it('tells the model the renamed worktree and leaves the prior checkout untouched', () => {
    const drafts = workspaceArrivalDrafts({
      from: EExecutionLocation.Cloud,
      to: EExecutionLocation.Host,
      path: restored.cwd,
      tree: restored.trees[0],
      repository: restored.repository,
    })
    expect(drafts).toContainEqual({
      type: 'worktree-entered',
      path: restored.cwd,
      branch: 'dennis/feature-a7c2',
      adopted: true,
    })
    const notice = drafts.find((draft) => draft.type === 'context-loaded')
    expect(notice?.type === 'context-loaded' && notice.content).toContain('feature-a7c2')
    expect(notice?.type === 'context-loaded' && notice.content).toContain('existing checkout was left untouched')
  })

  it('remaps parent and child directories by append without changing historical event identities', async () => {
    const fixture = openStoreFixture()
    held.push(fixture)
    const ids = new CountingIds('arrival')
    const parent = toThreadId('brn_arriving_parent')
    const child = toThreadId('brn_arriving_child')
    await fixture.threads.createWithFirstEvents({
      threadId: parent,
      runId: ids.nextRunId(),
      workspace: '/atlas/workspace',
      drafts: [{ type: 'user-said', text: 'work remotely' }],
    })
    await fixture.threads.createWithFirstEvents({
      threadId: child,
      runId: ids.nextRunId(),
      agent: { spawnedBy: parent, type: 'builder' },
      workspace: '/atlas/workspace/.atlas/worktrees/feature/subdir',
      drafts: [{ type: 'user-said', text: 'work in the subdirectory' }],
    })
    const original = await fixture.log.readOwn({ threadId: parent })

    await recordWorkspaceArrival({
      threadId: parent,
      from: EExecutionLocation.Cloud,
      to: EExecutionLocation.Host,
      restored,
      launchDirectory: '/atlas/workspace',
      log: fixture.log,
      threads: fixture.threads,
      ids,
    })

    const events = await fixture.log.readOwn({ threadId: parent })
    expect(events[0]).toEqual(original[0])
    expect(projectDirectoryOf({ events, launchDirectory: '/host/repo' })).toBe(restored.cwd)
    const childEvents = await fixture.log.readOwn({ threadId: child })
    expect(projectDirectoryOf({ events: childEvents, launchDirectory: '/host/repo' })).toBe(`${restored.cwd}/subdir`)
    expect((await fixture.threads.find({ threadId: child }))?.workspace).toBe(`${restored.cwd}/subdir`)
  })

  it('pins the restored checkout git identity on the arrival marker so cloud folds can track it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atlas-arrival-'))
    dirs.push(root)
    const git = (args: string[]) => runGit({ args, cwd: root })
    await git(['init', '-b', 'main'])
    await git(['remote', 'add', 'origin', 'https://github.com/compai/app.git'])
    await writeFile(join(root, 'README.md'), 'pinned\n')
    await git(['-c', 'user.name=Atlas Test', '-c', 'user.email=atlas@test.dev', 'add', '.'])
    await git(['-c', 'user.name=Atlas Test', '-c', 'user.email=atlas@test.dev', 'commit', '-m', 'seed'])

    const fixture = openStoreFixture()
    held.push(fixture)
    const threadId = toThreadId('brn_arriving_direct')
    await fixture.threads.createWithFirstEvents({
      threadId,
      runId: new CountingIds('arrival').nextRunId(),
      workspace: root,
      drafts: [{ type: 'user-said', text: 'work remotely' }],
    })

    await recordWorkspaceArrival({
      threadId,
      from: EExecutionLocation.Host,
      to: EExecutionLocation.Cloud,
      restored: { cwd: root, repository: root, trees: [] },
      launchDirectory: root,
      log: fixture.log,
      threads: fixture.threads,
      ids: new CountingIds('arrival'),
    })

    const events = await fixture.log.readOwn({ threadId })
    const marker = events.findLast((event) => event.type === 'location-changed')
    expect(marker?.type === 'location-changed' && marker.remoteUrl).toBe(
      'https://github.com/compai/app.git',
    )
    expect(marker?.type === 'location-changed' && marker.branch).toBe('main')
  })
})
