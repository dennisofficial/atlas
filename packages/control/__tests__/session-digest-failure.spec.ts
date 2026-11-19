import { describe, expect, it } from 'bun:test'

import { chainEvents, ESessionStatus, toRunId, toThreadId, type V2Body } from '@dltech/atlas-core'

import { ControlPlane } from '../src'
import type { ControlTx } from '../src/port'
import { InMemoryControlStore } from '../src/testing/memory'

const NOW = '2026-11-06T12:00:00.000Z'
const SESSION = 'session-1'
const THREAD = 'thread-1'
const USER = 'user-a'

const countingTx = (tx: ControlTx, countRead: () => void): ControlTx =>
  new Proxy(tx, {
    get: (target, prop) => {
      if (prop === 'readEvents') {
        return (...args: Parameters<ControlTx['readEvents']>) => {
          countRead()
          return target.readEvents(...args)
        }
      }
      const value: unknown = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })

class CountingStore extends InMemoryControlStore {
  readEventsCalls = 0

  override transact<T>(work: (tx: ControlTx) => Promise<T>): Promise<T> {
    return super.transact((tx) =>
      work(
        countingTx(tx, () => {
          this.readEventsCalls += 1
        }),
      ),
    )
  }
}

const posted = (inboxId: number): V2Body => ({
  type: 'input-posted',
  inboxId,
  kind: 'message',
  postedAt: NOW,
})

const setup = async () => {
  const store = new CountingStore({ clock: () => NOW })
  const plane = new ControlPlane({ store, clock: () => NOW })
  await plane.createSession({
    sessionId: SESSION,
    userId: USER,
    projectId: 'project-a',
    mainThreadId: THREAD,
  })
  const lease = await plane.grant({ sessionId: SESSION, hostId: 7 })
  const append = async (bodies: V2Body[]): Promise<void> => {
    const outcome = await plane.append({
      threadId: THREAD,
      epoch: lease.epoch,
      events: chainEvents({
        threadId: toThreadId(THREAD),
        runId: toRunId('run-1'),
        epoch: lease.epoch,
        at: NOW,
        bodies,
        from: await plane.head({ threadId: THREAD }),
      }),
    })
    if (!outcome.ok) throw new Error('append refused')
  }
  const post = async (text: string): Promise<{ inboxId: number }> =>
    plane.post({
      sessionId: SESSION,
      kind: 'message',
      payload: JSON.stringify({ text, via: 'operator' }),
    })
  const digest = async () => {
    store.readEventsCalls = 0
    const [row] = await plane.listSessionDigests({ userId: USER, limit: 10, withView: true })
    if (row?.view === undefined || row.view === null) throw new Error('no digest view')
    return { view: row.view, readEventsCalls: store.readEventsCalls }
  }
  return { store, plane, append, post, digest }
}

describe('session digests of a start-failed session', () => {
  it('digests a start failure as StartFailed without reading the event log', async () => {
    const { append, post, digest } = await setup()
    await append([{ type: 'workspace-prepared' }])
    const first = await post('a')
    await append([
      {
        type: 'session-start-failed',
        reason: 'sandbox is not configured',
        inboxHead: first.inboxId,
        permanent: false,
      },
    ])
    const { view, readEventsCalls } = await digest()
    expect(view.status.state).toBe(ESessionStatus.StartFailed)
    expect(readEventsCalls).toBe(0)
  })

  it('digests a message posted after the failure as Queued without reading the event log', async () => {
    const { append, post, digest } = await setup()
    await append([{ type: 'workspace-prepared' }])
    const first = await post('a')
    await append([
      {
        type: 'session-start-failed',
        reason: 'sandbox is not configured',
        inboxHead: first.inboxId,
        permanent: false,
      },
    ])
    const second = await post('b')
    await append([posted(second.inboxId)])
    const { view, readEventsCalls } = await digest()
    expect(view.status.state).toBe(ESessionStatus.Queued)
    expect(readEventsCalls).toBe(0)
  })
})
