import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { ESessionStatus } from '@dltech/atlas-core'
import { parseServerMessage } from '@dltech/atlas-protocol'

import { VIEW_COALESCE_MS } from '../session-views'
import { FollowRig, said, SESSION } from './follow-rig'

describe('session view', () => {
  let rig: FollowRig

  beforeEach(() => {
    rig = new FollowRig()
  })

  afterEach(() => {
    rig.dispose()
  })

  const views = () =>
    rig.frames('view').flatMap((frame) => (frame.name === 'session' ? [{ ...frame }] : []))

  it('sends the status at the head once a subscription is owned', async () => {
    await rig.seed({ events: 2 })
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    expect(views()).toEqual([
      {
        type: 'view',
        id: 'sub-1',
        name: 'session',
        at: 2,
        value: expect.objectContaining({
          at: 2,
          status: expect.objectContaining({ lease: { epoch: 1, holderHostId: 1, live: false } }),
          spend: expect.objectContaining({ rows: [] }),
        }),
      },
    ])
  })

  it('coalesces a burst of appends into one read per window', async () => {
    await rig.seed({ events: 1 })
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    const before = rig.statusReads
    for (let n = 0; n < 10; n += 1) await rig.append([said(`burst ${n}`)])
    await rig.settled()
    expect(rig.statusReads).toBe(before)
    rig.timers.advance(VIEW_COALESCE_MS)
    await rig.settled()
    expect(rig.statusReads).toBe(before + 1)
    expect(views().at(-1)?.at).toBe(11)
  })

  it('re-reads on a lease change that carries no head', async () => {
    rig.store.markHostPresent(1)
    await rig.seed({ events: 1 })
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    expect(views().at(-1)?.value.status.lease.live).toBe(true)
    await rig.plane.revoke({ sessionId: SESSION, wantsHolder: false })
    rig.timers.advance(VIEW_COALESCE_MS)
    await rig.settled()
    expect(views().at(-1)?.value.status.lease).toEqual({
      epoch: 2,
      holderHostId: null,
      live: false,
    })
  })

  it('sends nothing when a re-read finds the same view', async () => {
    await rig.seed({ events: 1 })
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    await rig.plane.wake({ sessionIds: [SESSION] })
    rig.timers.advance(VIEW_COALESCE_MS)
    await rig.settled()
    expect(rig.statusReads).toBe(2)
    expect(views()).toHaveLength(1)
  })

  it('resends an unchanged state when the head it was read at moves', async () => {
    await rig.seed({ events: 1 })
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    await rig.append([said('again')])
    rig.timers.advance(VIEW_COALESCE_MS)
    await rig.settled()
    expect(views().map((view) => view.at)).toEqual([1, 2])
    expect(views()[1]?.value.status.state).toBe(
      views()[0]?.value.status.state ?? ESessionStatus.Idle,
    )
  })

  it('gives a second subscriber the cached view without another read', async () => {
    await rig.seed({ events: 1 })
    const session = rig.open()
    await rig.subscribe({ session })
    await rig.settled()
    await rig.subscribe({ session, id: 'sub-2' })
    await rig.settled()
    expect(rig.statusReads).toBe(1)
    expect(views().map((view) => view.id)).toEqual(['sub-1', 'sub-2'])
  })

  it('recomputes on a change that carries no head, such as a pull request state write', async () => {
    await rig.seed({ events: 1 })
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    const before = rig.statusReads
    await rig.store.transact((tx) => tx.announce({ sessionId: SESSION }))
    rig.timers.advance(VIEW_COALESCE_MS)
    await rig.settled()
    expect(rig.statusReads).toBe(before + 1)
  })

  it('sends a version 2 watcher the session view and a version 1 watcher the status of the same read', async () => {
    await rig.seed({ events: 2 })
    const modern = rig.open('user-a', 2)
    const legacy = rig.open('user-a', 1)
    await rig.subscribe({ session: modern, id: 'new' })
    await rig.subscribe({ session: legacy, id: 'old' })
    await rig.settled()
    const frames = rig.frames('view')
    const fresh = frames.find((frame) => frame.id === 'new')
    const old = frames.find((frame) => frame.id === 'old')
    expect(fresh?.name).toBe('session')
    expect(old?.name).toBe('status')
    expect(old?.at).toBe(fresh?.at)
    expect(old?.value).toEqual(fresh?.name === 'session' ? fresh.value.status : undefined)
    expect(rig.statusReads).toBe(1)
  })

  it('shows a version 1 watcher a start failure as failed and a version 2 watcher as start-failed', async () => {
    await rig.seed({ events: 0 })
    await rig.append([
      { type: 'workspace-prepared' },
      { type: 'session-start-failed', reason: 'no sandbox', inboxHead: 1, permanent: true },
    ])
    await rig.subscribe({ session: rig.open('user-a', 2), id: 'new' })
    await rig.subscribe({ session: rig.open('user-a', 1), id: 'old' })
    await rig.settled()
    const states = Object.fromEntries(
      rig
        .frames('view')
        .map((frame) => [
          frame.id,
          frame.name === 'session' ? frame.value.status.state : frame.value.state,
        ]),
    )
    expect(states).toEqual({ new: ESessionStatus.StartFailed, old: ESessionStatus.Failed })
    for (const frame of rig.sent) {
      expect(parseServerMessage(JSON.parse(JSON.stringify(frame))).ok).toBe(true)
    }
    const old = rig.frames('view').find((frame) => frame.id === 'old')
    expect(old?.name).toBe('status')
  })
})
