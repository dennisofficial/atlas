import { describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { ControlPlane } from '../src/control-plane'
import { PostgresControlStore } from '../src/postgres'
import { mint, said, SESSION, THREAD } from '../src/testing/conformance/support'

describe('postgres session view read without an injected clock', () => {
  const testDb = useTestDatabase()

  const plane = () => new ControlPlane({ store: new PostgresControlStore(testDb().db) })

  const seeded = async () => {
    const control = plane()
    await control.createSession({
      sessionId: SESSION,
      userId: 'user-1',
      projectId: 'project-1',
      mainThreadId: THREAD,
    })
    return control
  }

  it('reads a cold view, folding it first', async () => {
    const control = await seeded()
    const read = await control.readSessionView({ sessionId: SESSION, threadId: THREAD })
    expect(read.at).toBe(0)
  })

  it('reads a current view after an append', async () => {
    const control = await seeded()
    const lease = await control.grant({ sessionId: SESSION, hostId: 9001 })
    const outcome = await control.append({
      threadId: THREAD,
      epoch: lease.epoch,
      events: mint({
        bodies: [said('hi')],
        epoch: lease.epoch,
        from: await control.head({ threadId: THREAD }),
      }),
    })
    expect(outcome.ok).toBe(true)
    const first = await control.readSessionView({ sessionId: SESSION, threadId: THREAD })
    const second = await control.readSessionView({ sessionId: SESSION, threadId: THREAD })
    expect(first.at).toBe(1)
    expect(second).toEqual(first)
  })
})
