import { describe, expect, it } from 'bun:test'

import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'

import { ControlPlane } from '../src/control-plane'
import { postIn } from '../src/inbox-ops'
import { PostgresControlStore } from '../src/postgres'

const currentDb = useTestDatabase()

const SPAWNER = 's1'
const T0 = '2026-11-26T10:00:00.000Z'

const deferred = () => {
  let open: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open: () => open() }
}

const rig = async () => {
  const { db } = currentDb()
  await seedUser({ db, id: 'u1' })
  await db.orm.public.Project.create({
    id: 'p1',
    name: 'project',
    ownerUserId: 'u1',
    createdById: 'u1',
    repo: null,
  })
  const store = new PostgresControlStore(db)
  const plane = new ControlPlane({ store })
  await plane.createSession({
    sessionId: SPAWNER,
    mainThreadId: 't1',
    userId: 'u1',
    projectId: 'p1',
  })
  return { plane, store, db }
}

describe('an original host and its replay posting at the same time', () => {
  it('waits out a post that holds the destination, then answers with its entry', async () => {
    const { plane, store, db } = await rig()
    const message = {
      sessionId: SPAWNER,
      kind: 'event',
      payload: JSON.stringify({
        clientId: 'call-1.0',
        event: { type: 'agent-reported', agentId: 'child', prose: 'done' },
      }),
    }
    const inserted = deferred()
    const hold = deferred()
    const first = store.transact(async (tx) => {
      const answered = await postIn({ tx, ...message, at: T0 })
      inserted.open()
      await hold.promise
      return answered.inboxId
    })
    await inserted.promise
    const second = plane.post(message)
    const early = await Promise.race([
      second.then(() => 'answered' as const),
      Bun.sleep(200).then(() => 'waiting' as const),
    ])
    hold.open()
    expect(early).toBe('waiting')
    expect((await second).inboxId).toBe(await first)
    expect(await db.orm.public.InboxEntry.where({ sessionId: SPAWNER }).all()).toHaveLength(1)
  })

  it('makes one session and one brief for two copies of a spawn', async () => {
    const { plane, db } = await rig()
    const spawn = {
      spawnerSessionId: SPAWNER,
      sessionId: 'child',
      mainThreadId: 'tc',
      brief: 'read the port',
    }
    const answers = await Promise.all([plane.spawnPeer(spawn), plane.spawnPeer(spawn)])
    const spawned = answers.flatMap((answer) => ('inboxId' in answer ? [answer] : []))
    expect(spawned).toHaveLength(2)
    expect(new Set(spawned.map((answer) => answer.inboxId)).size).toBe(1)
    expect(await db.orm.public.Session.where({ id: 'child' }).all()).toHaveLength(1)
    expect(await db.orm.public.InboxEntry.where({ sessionId: 'child' }).all()).toHaveLength(1)
  })
})
