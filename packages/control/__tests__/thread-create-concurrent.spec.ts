import { describe, expect, it } from 'bun:test'

import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'

import { ControlPlane } from '../src/control-plane'
import { InMemoryControlStore } from '../src/testing'
import { PostgresControlStore } from '../src/postgres'
import type { ControlTx } from '../src/port'
import { EMPTY_VISIBILITY_TEXT } from '../src/stored-event'

const currentDb = useTestDatabase()

const T0 = '2026-11-26T10:00:00.000Z'

describe('an original and its replay creating one child thread together', () => {
  it('lets the overlapping pair create the same child thread', async () => {
    const { db } = currentDb()
    await seedUser({ db, id: 'u1' })
    const store = new PostgresControlStore(db)
    const bare = new ControlPlane({ store })
    await bare.createSession({
      sessionId: 's1',
      mainThreadId: 'main',
      userId: 'u1',
      projectId: null,
    })
    let reads = 0
    let release: () => void = () => undefined
    const bothRead = new Promise<void>((resolve) => {
      release = resolve
    })
    class PausingStore extends PostgresControlStore {
      override transact<T>(work: (tx: ControlTx) => Promise<T>): Promise<T> {
        return super.transact((tx) =>
          work(
            new Proxy(tx, {
              get(target, property) {
                if (property === 'readThread')
                  return async (threadId: string) => {
                    const row = await target.readThread(threadId)
                    if (threadId !== 'child') return row
                    reads += 1
                    if (reads === 2) release()
                    await bothRead
                    return row
                  }
                const value = Reflect.get(target, property)
                return typeof value === 'function' ? value.bind(target) : value
              },
            }),
          ),
        )
      }
    }
    const concurrent = new ControlPlane({ store: new PausingStore(db) })
    const results = await Promise.allSettled([
      concurrent.createThread({ sessionId: 's1', threadId: 'child' }),
      concurrent.createThread({ sessionId: 's1', threadId: 'child' }),
    ])
    expect(results.filter((result) => result.status === 'rejected')).toEqual([])
    expect(await db.orm.public.Thread.where({ sessionId: 's1' }).all()).toHaveLength(2)
  })
})

describe('the memory store', () => {
  const memoryPlaneOf = async () => {
    const store = new InMemoryControlStore({ clock: () => T0 })
    const plane = new ControlPlane({ store })
    await plane.createSession({
      sessionId: 's1',
      mainThreadId: 'main',
      userId: 'u1',
      projectId: null,
    })
    return { store, plane }
  }

  it('answers a repeated create of one thread in the same session', async () => {
    const { plane } = await memoryPlaneOf()
    const results = await Promise.allSettled([
      plane.createThread({ sessionId: 's1', threadId: 'child' }),
      plane.createThread({ sessionId: 's1', threadId: 'child' }),
    ])
    expect(results.filter((result) => result.status === 'rejected')).toEqual([])
  })

  it('still refuses a thread another session owns', async () => {
    const { store, plane } = await memoryPlaneOf()
    await plane.createSession({
      sessionId: 's2',
      mainThreadId: 'main-2',
      userId: 'u1',
      projectId: null,
    })
    await plane.createThread({ sessionId: 's1', threadId: 'child' })
    await expect(plane.createThread({ sessionId: 's2', threadId: 'child' })).rejects.toThrow(
      'belongs to another session',
    )
    expect(await store.transact((tx) => tx.readThread('child'))).toMatchObject({
      threadId: 'child',
      sessionId: 's1',
    })
  })

  it('lets the store ensure a thread that already exists without refusing', async () => {
    const { store } = await memoryPlaneOf()
    const ensure = () =>
      store.transact((tx) =>
        tx.ensureThread({
          threadId: 'child',
          sessionId: 's1',
          visibility: EMPTY_VISIBILITY_TEXT,
          at: T0,
        }),
      )
    await ensure()
    await ensure()
    expect(await store.transact((tx) => tx.readThread('child'))).toMatchObject({
      threadId: 'child',
      sessionId: 's1',
      headSeq: 0,
    })
  })
})
