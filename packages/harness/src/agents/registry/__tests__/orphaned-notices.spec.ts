import { afterEach, describe, expect, it } from 'bun:test'

import type { ThreadId } from '@dltech/atlas-core'

import { fakeRunners, finished, loggedOfType, openSupervisor, settled, type OpenedSupervisor } from './fixtures'

let opened: OpenedSupervisor | undefined

afterEach(async () => {
  await opened?.close()
  opened = undefined
})

describe('a child’s leftover notices at completion', () => {
  it('hands them to the parent thread the moment the child finishes', async () => {
    const inherited: { from: ThreadId; to: ThreadId }[] = []
    opened = await openSupervisor({
      inheritOrphanedNotices: (args) => {
        inherited.push(args)
      },
    })
    const { supervisor, runners, parent } = opened

    const spawned = await supervisor.spawn({
      threadId: parent,
      agentType: 'explore',
      brief: 'finish immediately',
      intent: 'orphan probe',
    })
    if (!spawned.ok) throw new Error(spawned.reason)

    const started = runners.started[0]
    if (started === undefined) throw new Error('the child never ran')
    started.settle(finished())
    await settled()
    await settled()

    expect(inherited).toEqual([{ from: started.threadId, to: parent }])
  })

  it('hands nothing over while the child is still running', async () => {
    const inherited: { from: ThreadId; to: ThreadId }[] = []
    opened = await openSupervisor({
      inheritOrphanedNotices: (args) => {
        inherited.push(args)
      },
    })
    const { supervisor, runners, parent } = opened

    const spawned = await supervisor.spawn({
      threadId: parent,
      agentType: 'explore',
      brief: 'hold the step open',
      intent: 'orphan probe',
    })
    if (!spawned.ok) throw new Error(spawned.reason)

    expect(runners.started).toHaveLength(1)
    expect(inherited).toEqual([])
  })

  it('runs without the wiring when composition supplies none', async () => {
    opened = await openSupervisor()
    const { harness, supervisor, runners, parent } = opened

    const spawned = await supervisor.spawn({
      threadId: parent,
      agentType: 'explore',
      brief: 'finish immediately',
      intent: 'orphan probe',
    })
    if (!spawned.ok) throw new Error(spawned.reason)

    const started = runners.started[0]
    if (started === undefined) throw new Error('the child never ran')
    started.settle(finished())
    await supervisor.whenChildrenSettled({ threadId: parent })

    expect(await loggedOfType({ harness, threadId: parent, type: 'agent-ended' })).toHaveLength(1)
    expect(supervisor.pendingNotices({ threadId: parent })).toHaveLength(1)
  })
})
