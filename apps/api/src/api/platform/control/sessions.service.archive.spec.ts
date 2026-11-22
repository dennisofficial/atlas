import { describe, expect, it } from 'bun:test'
import { ESubscriptionActor } from '@dltech/atlas-core'

import { setupSessionsService as setup } from './sessions.service.fixture'

describe('SessionsService archive cascade', () => {
  it('archives every nested descendant and unarchives only the session it is given', async () => {
    const { plane, service } = setup()
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })
    await plane.spawnPeer({
      spawnerSessionId: created.sessionId,
      sessionId: 'child',
      mainThreadId: 'child-thread',
      title: 'Child',
    })
    await plane.spawnPeer({
      spawnerSessionId: 'child',
      sessionId: 'grandchild',
      mainThreadId: 'grandchild-thread',
      title: 'Grandchild',
    })
    await plane.subscribe({
      sessionId: 'child',
      threadId: 'child-thread',
      provider: 'github.pull-request',
      target: { repo: 'github.com/compai/app', number: 4 },
      label: 'compai/app#4',
      events: [],
      lease: { repo: 'compai/app', subject: { kind: 'pull-request', number: 4 } },
      by: ESubscriptionActor.Agent,
    })

    const archived = await service.archive({
      userId: 'user-a',
      sessionId: created.sessionId,
      archived: true,
    })

    const stamp = archived.archivedAt
    expect(stamp).toEqual(expect.any(String))
    expect((await plane.readSession({ sessionId: 'child' }))?.archivedAt).toBe(stamp)
    expect((await plane.readSession({ sessionId: 'grandchild' }))?.archivedAt).toBe(stamp)
    expect(await plane.listSubscriptions({ sessionId: 'child' })).toEqual([])

    await service.archive({ userId: 'user-a', sessionId: created.sessionId, archived: false })

    expect((await plane.readSession({ sessionId: created.sessionId }))?.archivedAt).toBeNull()
    expect((await plane.readSession({ sessionId: 'child' }))?.archivedAt).toBe(stamp)
    expect((await plane.readSession({ sessionId: 'grandchild' }))?.archivedAt).toBe(stamp)
  })
})
