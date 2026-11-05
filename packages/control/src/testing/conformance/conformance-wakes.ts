import { beforeEach, describe, expect, it } from 'bun:test'

import { postIn } from '../../inbox-ops'
import { createSessionParams, HOLDER_HOST, makeHarness, T0, type Harness } from './support'
import type { ConformanceParams } from './conformance'

const WAKE_SESSION = 'wakes-session'
const WAKE_THREAD = 'wakes-thread'
const WAKE_OTHER = 'wakes-other'

export function describeControlPlaneWakes(params: ConformanceParams): void {
  describe(`ControlPlane wakes (${params.name})`, () => {
    let harness: Harness

    beforeEach(async () => {
      await params.reset()
      harness = makeHarness(params.makeStore())
    })

    it('createSession notifies once on commit', async () => {
      await harness.plane.createSession(
        createSessionParams({ sessionId: WAKE_SESSION, mainThreadId: WAKE_THREAD }),
      )
      expect(await params.wakes(WAKE_SESSION)).toBe(1)
    })

    it('a rolled-back createSession notifies nothing', async () => {
      const store = params.makeStore()
      await expect(
        store.transact(async (tx) => {
          await tx.createSession({
            ...createSessionParams({ sessionId: WAKE_SESSION, mainThreadId: WAKE_THREAD }),
            at: T0,
          })
          await tx.notifyWake(WAKE_SESSION)
          throw new Error('forced rollback')
        }),
      ).rejects.toThrow('forced rollback')
      expect(await params.wakes(WAKE_SESSION)).toBe(0)
    })

    it('post notifies once on commit, for a message and for a stop', async () => {
      await harness.plane.createSession(
        createSessionParams({ sessionId: WAKE_SESSION, mainThreadId: WAKE_THREAD }),
      )
      await harness.plane.post({ sessionId: WAKE_SESSION, kind: 'user', payload: '"a"' })
      expect(await params.wakes(WAKE_SESSION)).toBe(2)
      await harness.plane.post({ sessionId: WAKE_SESSION, kind: 'stop', payload: '{}' })
      expect(await params.wakes(WAKE_SESSION)).toBe(3)
    })

    it('a rolled-back post notifies nothing', async () => {
      const store = params.makeStore()
      await harness.plane.createSession(
        createSessionParams({ sessionId: WAKE_SESSION, mainThreadId: WAKE_THREAD }),
      )
      await expect(
        store.transact(async (tx) => {
          await postIn({ tx, sessionId: WAKE_SESSION, kind: 'user', payload: '"a"', at: T0 })
          throw new Error('forced rollback')
        }),
      ).rejects.toThrow('forced rollback')
      expect(await params.wakes(WAKE_SESSION)).toBe(1)
    })

    it('a wantsHolder revoke notifies; a plain revoke does not', async () => {
      await harness.plane.createSession(
        createSessionParams({ sessionId: WAKE_SESSION, mainThreadId: WAKE_THREAD }),
      )
      await harness.plane.grant({ sessionId: WAKE_SESSION, hostId: HOLDER_HOST })
      await harness.plane.revoke({ sessionId: WAKE_SESSION, wantsHolder: false })
      expect(await params.wakes(WAKE_SESSION)).toBe(1)
      await harness.plane.grant({ sessionId: WAKE_SESSION, hostId: HOLDER_HOST })
      await harness.plane.revoke({ sessionId: WAKE_SESSION, wantsHolder: true })
      expect(await params.wakes(WAKE_SESSION)).toBe(2)
    })

    it('a wantsHolder revokeIfEpoch notifies once when it lands', async () => {
      await harness.plane.createSession(
        createSessionParams({ sessionId: WAKE_SESSION, mainThreadId: WAKE_THREAD }),
      )
      const lease = await harness.plane.grant({ sessionId: WAKE_SESSION, hostId: HOLDER_HOST })
      const refused = await harness.plane.revoke({
        sessionId: WAKE_SESSION,
        wantsHolder: true,
        epoch: lease.epoch + 1,
      })
      expect(refused).toMatchObject({ ok: false })
      expect(await params.wakes(WAKE_SESSION)).toBe(1)
      const landed = await harness.plane.revoke({
        sessionId: WAKE_SESSION,
        wantsHolder: true,
        epoch: lease.epoch,
      })
      expect(landed).toMatchObject({ ok: true })
      expect(await params.wakes(WAKE_SESSION)).toBe(2)
    })

    it('wake notifies each listed session exactly once', async () => {
      await harness.plane.createSession(
        createSessionParams({ sessionId: WAKE_SESSION, mainThreadId: WAKE_THREAD }),
      )
      await harness.plane.createSession(
        createSessionParams({ sessionId: WAKE_OTHER, mainThreadId: 'wakes-other-thread' }),
      )
      await harness.plane.wake({ sessionIds: [WAKE_SESSION, WAKE_OTHER] })
      expect(await params.wakes(WAKE_SESSION)).toBe(2)
      expect(await params.wakes(WAKE_OTHER)).toBe(2)
    })
  })
}
