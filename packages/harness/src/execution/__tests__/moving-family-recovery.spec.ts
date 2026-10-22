import { describe, expect, it } from 'bun:test'

import { EKilledBy, EShellStatus } from '@dltech/atlas-core'

import { familyRecoveryFixture } from '../../shells/__tests__/family-recovery.spec'
import { stopMovingShells } from '../moving-shells'

describe('moving recovered shell families', () => {
  it('discovers and stops moving descendants before allowing a local location commit', async () => {
    const f = await familyRecoveryFixture()
    for (const owner of [f.root, f.child, f.teammate, f.grandchild, f.stranger]) await f.seed(owner)
    const order: string[] = []
    const stopped = await stopMovingShells({ root: f.root, threads: f.threads, shells: f.shells })
    order.push('stopped')
    expect(f.shells.list({ threadId: f.child })[0]?.status).toBe(EShellStatus.Killed)
    order.push('commit')
    expect(order).toEqual(['stopped', 'commit'])
    expect(stopped).toBe(2)
    expect(f.killed.sort()).toEqual([f.root, f.child].sort())
    expect(f.inspected.sort()).toEqual([f.root, f.child].sort())
  })

  it('whole-family cloud stops include teammates and their descendants after restart', async () => {
    const f = await familyRecoveryFixture()
    for (const owner of [f.child, f.teammate, f.grandchild, f.stranger]) await f.seed(owner)
    const stopped = await f.shells.stopOwners({
      threadIds: [f.root, f.child, f.teammate, f.grandchild],
      by: EKilledBy.ContainerSwitch,
      ms: 1000,
    })
    expect(stopped.map((shell) => shell.threadId).sort()).toEqual([f.child, f.teammate, f.grandchild].sort())
    expect(f.killed).not.toContain(f.stranger)
  })

  it('refuses a location commit if a recovered shell remains alive', async () => {
    const f = await familyRecoveryFixture()
    await f.seed(f.child)
    f.refuseKills()
    let committed = false
    await expect(f.shells.stopOwners({
      threadIds: [f.child], by: EKilledBy.ContainerSwitch, ms: 1,
    }).then(() => { committed = true })).rejects.toThrow('have not stopped')
    expect(committed).toBe(false)
  })

  it('terminates traversal of cyclic stored spawners', async () => {
    const f = await familyRecoveryFixture()
    await f.seed(f.child)
    const rootSummary = await f.threads.find({ threadId: f.root })
    const childSummary = await f.threads.find({ threadId: f.child })
    if (rootSummary === undefined || childSummary === undefined) throw new Error('missing fixture family')
    const visited: string[] = []
    const threads = {
      spawned: async ({ threadId }: { threadId: typeof f.root }) => {
        visited.push(threadId)
        return threadId === f.root ? [childSummary] : [rootSummary]
      },
    }
    await stopMovingShells({ root: f.root, threads, shells: f.shells })
    expect(visited).toEqual([f.root, f.child])
    expect(f.killed).toEqual([f.child])
  })
})
