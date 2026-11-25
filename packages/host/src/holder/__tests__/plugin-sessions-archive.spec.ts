import { describe, expect, it } from 'bun:test'

import { chainEvents, EEffort, toRunId, toThreadId, type RecordEventBody } from '@dltech/atlas-core'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'

import { podSessionsOf } from '../plugin-sessions'

const T0 = '2026-11-23T10:00:00.000Z'
const SPAWNER = { sessionId: 's1', mainThreadId: 't1', userId: 'u1', projectId: 'p1' }
const MODEL = { ref: { providerId: 'openai', modelId: 'gpt-5' }, effort: EEffort.High, fast: true }

const appendAsHolder = async (args: {
  plane: ControlPlane
  sessionId: string
  threadId: string
  bodies: RecordEventBody[]
}): Promise<void> => {
  const granted = await args.plane.grant({ sessionId: args.sessionId, hostId: 9000 })
  const appended = await args.plane.append({
    threadId: args.threadId,
    epoch: granted.epoch,
    events: chainEvents({
      threadId: toThreadId(args.threadId),
      runId: toRunId('run-1'),
      epoch: granted.epoch,
      at: T0,
      bodies: args.bodies,
    }),
  })
  if (!appended.ok) throw new Error('the append was refused')
  await args.plane.revoke({ sessionId: args.sessionId, wantsHolder: false })
}

const rig = async () => {
  const plane = new ControlPlane({
    store: new InMemoryControlStore({ clock: () => T0 }),
    clock: () => T0,
  })
  await plane.createSession(SPAWNER)
  const parked: string[] = []
  const sessions = podSessionsOf({
    plane,
    sessionId: SPAWNER.sessionId,
    model: () => MODEL,
    parkArchived: async ({ sessionId }) => {
      parked.push(sessionId)
    },
  })
  const idleChild = async (nested: boolean) => {
    const spawned = await sessions.spawn({ nested })
    await appendAsHolder({
      plane,
      sessionId: spawned.sessionId,
      threadId: spawned.mainThreadId,
      bodies: [{ type: 'workspace-prepared' }],
    })
    return spawned
  }
  return { plane, sessions, parked, idleChild }
}

describe('podSessionsOf archive', () => {
  it('archives an idle teammate and parks its pod', async () => {
    const { plane, sessions, parked, idleChild } = await rig()
    const child = await idleChild(true)

    const archived = await sessions.archive({ sessionId: child.sessionId })

    expect(archived).toEqual({ archived: true, already: false })
    expect((await plane.readSession({ sessionId: child.sessionId }))?.archivedAt).toBe(T0)
    expect(parked).toEqual([child.sessionId])
  })

  it('archives a session made with spawn_session', async () => {
    const { sessions, idleChild } = await rig()
    const child = await idleChild(false)

    expect(await sessions.archive({ sessionId: child.sessionId })).toEqual({
      archived: true,
      already: false,
    })
  })

  it('does not park the pod again on a repeat archive', async () => {
    const { sessions, parked, idleChild } = await rig()
    const child = await idleChild(true)
    await sessions.archive({ sessionId: child.sessionId })

    expect(await sessions.archive({ sessionId: child.sessionId })).toEqual({
      archived: true,
      already: true,
    })
    expect(parked).toEqual([child.sessionId])
  })

  it('refuses a session it did not spawn and parks nothing', async () => {
    const { plane, sessions, parked } = await rig()
    await plane.createSession({ ...SPAWNER, sessionId: 'mine', mainThreadId: 't-mine' })

    const archived = await sessions.archive({ sessionId: 'mine' })

    expect(archived).toEqual({
      refused: 'session mine was not spawned by this session, so only the operator can archive it',
    })
    expect((await plane.readSession({ sessionId: 'mine' }))?.archivedAt).toBeNull()
    expect(parked).toEqual([])
  })
})
