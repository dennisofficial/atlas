import { describe, expect, it } from 'bun:test'

import { EKilledBy, EShellStatus, type ThreadId } from '@dltech/atlas-core'

import { familyRecoveryFixture } from './family-recovery-fixture'

describe('family shell recovery', () => {
  it('observes stored descendants when only their parent reopens, and ends in each owner log', async () => {
    const f = await familyRecoveryFixture()
    for (const owner of [f.child, f.teammate, f.grandchild, f.stranger]) await f.seed(owner)

    await Promise.all([
      f.shells.reconcile({ threadId: f.root }),
      f.shells.reconcile({ threadId: f.root }),
    ])

    expect(f.inspected.sort()).toEqual([f.child, f.teammate, f.grandchild].sort())
    expect(
      f.shells
        .listEverywhere()
        .map((shell) => shell.threadId)
        .sort(),
    ).toEqual([f.child, f.teammate, f.grandchild].sort())
    const ended = new Promise<void>((resolve) => {
      const unsubscribe = f.shells.subscribe(() => {
        if (f.shells.list({ threadId: f.child })[0]?.status === EShellStatus.Running) return
        unsubscribe()
        resolve()
      })
    })
    f.finish(f.child)
    await ended
    await f.shells.awaitEndings({ threadId: f.child, ms: 1000 })
    expect(
      (await f.log.readOwn({ threadId: f.child })).filter(
        (event) => event.type === 'background-shell-ended',
      ),
    ).toHaveLength(1)
    expect(await f.log.readOwn({ threadId: f.root })).toEqual([])
    expect(f.shells.pendingNotices({ threadId: f.root })).toEqual([])
    expect(f.shells.pendingNotices({ threadId: f.child })).toHaveLength(1)
    for (const owner of [f.teammate, f.grandchild]) {
      await f.shells.stopOwners({ threadIds: [owner], by: EKilledBy.SessionEnd, ms: 1000 })
      expect(
        (await f.log.readOwn({ threadId: owner })).filter(
          (event) => event.type === 'background-shell-ended',
        ),
      ).toHaveLength(1)
      expect(f.shells.pendingNotices({ threadId: owner })).toHaveLength(1)
    }
    expect(await f.log.readOwn({ threadId: f.root })).toEqual([])
  })

  it('cold close uses its explicit family fence without sweeping unrelated sessions', async () => {
    const f = await familyRecoveryFixture()
    for (const owner of [f.child, f.teammate, f.grandchild, f.stranger]) await f.seed(owner)
    await f.shells.closeAll({ threadId: f.root, killedBy: EKilledBy.SessionEnd })
    expect(f.killed.sort()).toEqual([f.child, f.teammate, f.grandchild].sort())
    expect(f.inspected).not.toContain(f.stranger)
    expect((await f.log.readOwn({ threadId: f.stranger })).map((event) => event.type)).toEqual([
      'background-shell-started',
    ])
  })

  it('normal close discovers descendants of an admitted owner', async () => {
    const f = await familyRecoveryFixture()
    await f.shells.reconcile({ threadId: f.root })
    await f.seed(f.child)
    await f.shells.closeAll()
    expect(f.killed).toEqual([f.child])
  })

  it('reconciliation traverses cyclic lineage once per owner', async () => {
    const f = await familyRecoveryFixture()
    await f.seed(f.grandchild)
    const rootSummary = await f.threads.find({ threadId: f.root })
    if (rootSummary === undefined) throw new Error('missing root')
    const spawned = f.threads.spawned.bind(f.threads)
    const visited: ThreadId[] = []
    f.threads.spawned = async (args) => {
      visited.push(args.threadId)
      return args.threadId === f.grandchild ? [rootSummary] : spawned(args)
    }
    await f.shells.reconcile({ threadId: f.root })
    expect(new Set(visited).size).toBe(4)
    expect(visited).toHaveLength(4)
    expect(f.inspected).toEqual([f.grandchild])
  })

  it('a registry with no known owners does not sweep disk during close', async () => {
    const f = await familyRecoveryFixture()
    await f.seed(f.child)
    await f.shells.closeAll()
    expect(f.inspected).toEqual([])
    expect(f.killed).toEqual([])
  })
})
