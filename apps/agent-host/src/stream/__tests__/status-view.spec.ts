import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { ESessionStatus } from '@dltech/atlas-core'

import { STATUS_COALESCE_MS } from '../status-views'
import { FollowRig, said, SESSION } from './follow-rig'

describe('status view', () => {
  let rig: FollowRig

  beforeEach(() => {
    rig = new FollowRig()
  })

  afterEach(() => {
    rig.dispose()
  })

  const views = () => rig.frames('view')

  it('sends the status at the head once a subscription is owned', async () => {
    await rig.seed({ events: 2 })
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    expect(views()).toEqual([
      {
        type: 'view',
        id: 'sub-1',
        name: 'status',
        at: 2,
        value: expect.objectContaining({ lease: { epoch: 1, holderHostId: 1, live: false } }),
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
    rig.timers.advance(STATUS_COALESCE_MS)
    await rig.settled()
    expect(rig.statusReads).toBe(before + 1)
    expect(views().at(-1)?.at).toBe(11)
  })

  it('re-reads on a lease change that carries no head', async () => {
    rig.store.markHostPresent(1)
    await rig.seed({ events: 1 })
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    expect(views().at(-1)?.value.lease.live).toBe(true)
    await rig.plane.revoke({ sessionId: SESSION, wantsHolder: false })
    rig.timers.advance(STATUS_COALESCE_MS)
    await rig.settled()
    expect(views().at(-1)?.value.lease).toEqual({ epoch: 2, holderHostId: null, live: false })
  })

  it('sends nothing when a re-read finds the same view', async () => {
    await rig.seed({ events: 1 })
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    await rig.plane.wake({ sessionIds: [SESSION] })
    rig.timers.advance(STATUS_COALESCE_MS)
    await rig.settled()
    expect(rig.statusReads).toBe(2)
    expect(views()).toHaveLength(1)
  })

  it('resends an unchanged state when the head it was read at moves', async () => {
    await rig.seed({ events: 1 })
    await rig.subscribe({ session: rig.open() })
    await rig.settled()
    await rig.append([said('again')])
    rig.timers.advance(STATUS_COALESCE_MS)
    await rig.settled()
    expect(views().map((view) => view.at)).toEqual([1, 2])
    expect(views()[1]?.value.state).toBe(views()[0]?.value.state ?? ESessionStatus.Idle)
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
})
