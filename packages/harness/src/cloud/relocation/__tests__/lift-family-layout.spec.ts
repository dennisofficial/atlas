import { describe, expect, it } from 'bun:test'

import { toRunId, type EventDraft, type ThreadId } from '@dltech/atlas-core'
import { CLOUD_WORKSPACE_PATH } from '@dltech/atlas-wire'

import type { RestoredWorkspace } from '../../../workspace/transfer/manifest'
import { useAtlasHome } from './descend-fixture'
import { fakeAgentSnapshot } from './fake-agents'
import { CLOUD_THREAD, fakeBridge } from './fixture'
import { CHILD, fakeLiftAgents, harness } from './lift-fixture'
import { liftToCloud } from '../lift'
import { WORKSPACE_MANIFEST } from './workspace-fixture'

const LOCAL_REPOSITORY = '/Users/me/atlas'
const LOCAL_WORKTREE = `${LOCAL_REPOSITORY}/.atlas/worktrees/feat`
const CLOUD_REPOSITORY = '/atlas/workspaces/atlas'
const CLOUD_WORKTREE = `${CLOUD_REPOSITORY}/.atlas/worktrees/feat`

const RESTORED: RestoredWorkspace = {
  cwd: CLOUD_REPOSITORY,
  repository: CLOUD_REPOSITORY,
  trees: [
    { id: 'main', sourcePath: LOCAL_REPOSITORY, path: CLOUD_REPOSITORY, branch: 'main', renamedFrom: null },
    { id: 'feat', sourcePath: LOCAL_WORKTREE, path: CLOUD_WORKTREE, branch: 'feat', renamedFrom: null },
  ],
}

const liftedChildCwd = async (args: {
  childWorkspace: string
  drafts?: EventDraft[]
  archive: boolean
}): Promise<string | undefined> => {
  useAtlasHome()
  const agents = fakeLiftAgents([fakeAgentSnapshot({ agentId: 'child-1', spawnedBy: CLOUD_THREAD })])
  const bridge = fakeBridge({ restoredWorkspace: RESTORED })
  const test = harness({
    agents,
    bridge,
    ...(args.archive
      ? {
          captureWorkspaceArchive: async () => ({
            path: '/tmp/atlas-lift-workspace-x/workspace.tar.gz',
            manifest: WORKSPACE_MANIFEST,
            release: async () => {},
          }),
        }
      : {}),
  })
  await test.localThreads.createWithFirstEvents({
    threadId: CHILD as ThreadId,
    runId: toRunId('run_child'),
    drafts: [{ type: 'user-said', text: 'explore' }, ...(args.drafts ?? [])],
    workspace: args.childWorkspace,
    agent: { spawnedBy: CLOUD_THREAD, type: 'explore' },
  })

  const lifted = await liftToCloud(test.args)
  if (!lifted.ok) throw new Error('expected the lift to succeed')

  const marker = test.localLog.peek({ threadId: CHILD }).find((event) => event.type === 'location-changed')
  return marker?.type === 'location-changed' ? marker.cwd : undefined
}

describe('the cwd a lifted child records for its cloud location', () => {
  it('names the named primary for a child working in the repository root', async () => {
    expect(await liftedChildCwd({ childWorkspace: LOCAL_REPOSITORY, archive: true })).toBe(CLOUD_REPOSITORY)
  })

  it('maps a child in a nested directory beneath the named primary', async () => {
    const cwd = await liftedChildCwd({
      childWorkspace: LOCAL_REPOSITORY,
      drafts: [{ type: 'directory-changed', path: `${LOCAL_REPOSITORY}/packages/core`, repo: LOCAL_REPOSITORY }],
      archive: true,
    })

    expect(cwd).toBe(`${CLOUD_REPOSITORY}/packages/core`)
  })

  it('maps a child inside a linked worktree to the restored worktree', async () => {
    const cwd = await liftedChildCwd({
      childWorkspace: LOCAL_REPOSITORY,
      drafts: [{ type: 'worktree-entered', path: LOCAL_WORKTREE, branch: 'feat' }],
      archive: true,
    })

    expect(cwd).toBe(CLOUD_WORKTREE)
  })

  it('places a child that was outside every transferred tree at the restored root', async () => {
    expect(await liftedChildCwd({ childWorkspace: '/Users/me/sibling', archive: true })).toBe(CLOUD_REPOSITORY)
  })

  it('keeps the unnamed fallback when no workspace archive was restored', async () => {
    expect(await liftedChildCwd({ childWorkspace: LOCAL_REPOSITORY, archive: false })).toBe(CLOUD_WORKSPACE_PATH)
  })
})
