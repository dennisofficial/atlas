import { describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { ControlPlane } from '../src/control-plane'
import { PostgresControlStore } from '../src/postgres'

const SESSION = 'session-pod-size-pg'
const THREAD = 'thread-pod-size-pg'

// The postgres writers forward their parameters to the store tx, and a store tx that forwards the
// caller's own tx handle sets its own aside: the pod size writes are the ones that carry a tx in
// their parameters, so they go through a real Postgres tx here and not the in-memory double.
describe('pod size on postgres', () => {
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

  const podOf = async (control: ControlPlane) =>
    (await control.readSessionView({ sessionId: SESSION, threadId: THREAD })).value.status.pod

  it('records the applied size for the current generation', async () => {
    const control = await seeded()
    const generation = await control.recordPodDesired({ sessionId: SESSION, vcpus: 2 })

    expect(await control.recordPodApplied({ sessionId: SESSION, vcpus: 2, generation })).toBe(true)
    expect(await podOf(control)).toEqual({ desiredVcpus: 2, actualVcpus: 2, phase: 'steady' })
  })

  it('records a failed resize as the error on the row', async () => {
    const control = await seeded()
    const generation = await control.recordPodDesired({ sessionId: SESSION, vcpus: 2 })

    expect(
      await control.recordPodFailed({
        sessionId: SESSION,
        generation,
        error: 'No sandbox to resize',
      }),
    ).toBe(true)
    expect(await podOf(control)).toEqual({
      desiredVcpus: 2,
      phase: 'failed',
      error: 'No sandbox to resize',
    })
  })

  it('ignores an apply for a generation a newer resize superseded', async () => {
    const control = await seeded()
    const first = await control.recordPodDesired({ sessionId: SESSION, vcpus: 2 })
    await control.recordPodDesired({ sessionId: SESSION, vcpus: 8 })

    expect(
      await control.recordPodApplied({ sessionId: SESSION, vcpus: 2, generation: first }),
    ).toBe(false)
    expect(await podOf(control)).toEqual({ desiredVcpus: 8, phase: 'resizing' })
  })
})
